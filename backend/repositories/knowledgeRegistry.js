const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const normalize = (name) => String(name || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '');

// 单进程服务的持久知识点库。先原子写盘，再发布内存快照；写入失败不能假装保存成功。
function createRegistry(seeds, storagePath) {
  let state = { schemaVersion: 1, revision: 0, points: [], aliases: {} };
  if (storagePath && fs.existsSync(storagePath)) {
    state = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
    if (state.schemaVersion !== 1 || !Array.isArray(state.points) || !state.aliases || !Number.isInteger(state.revision)) {
      throw new Error('知识点库文件格式错误，请从备份恢复，不能覆盖现有分类');
    }
  }
  const base = seeds.map((p) => ({
    ...p, definition: p.definition || `${p.path.join(' / ')}中${p.name}的概念与应用。`,
    boundary: p.boundary || '按实际考查的概念与解题步骤归类；题型、数字、情境与错误原因不作为新知识点。',
    source: 'builtin',
  }));
  const points = () => [...base, ...state.points];
  const getPoint = (id) => points().find((p) => p.id === id) || null;
  function commit(next) {
    if (storagePath) {
      fs.mkdirSync(path.dirname(storagePath), { recursive: true });
      const tmp = `${storagePath}.${crypto.randomUUID()}.tmp`;
      try {
        fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { encoding: 'utf8', flag: 'wx' });
        fs.renameSync(tmp, storagePath);
      } finally {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      }
    }
    state = next;
  }
  function listForPrompt() {
    return points().map((p) => ({ ...p, aliases: [...new Set([...(p.aliases || []), ...(state.aliases[p.id] || [])])] }));
  }
  function findByName(name) {
    const key = normalize(name);
    const matches = listForPrompt().filter((p) => [p.name, ...p.aliases].some((n) => normalize(n) === key));
    // 同名异义不按顺序任选，交给有题目上下文的语义判定。
    return matches.length === 1 ? matches[0] : null;
  }
  function addAlias(id, name) {
    if (!getPoint(id)) throw new Error('不能给不存在的知识点添加别名');
    const p = listForPrompt().find((p) => p.id === id);
    if ([p.name, ...p.aliases].some((n) => normalize(n) === normalize(name))) return;
    commit({ ...state, revision: state.revision + 1, aliases: { ...state.aliases, [id]: [...(state.aliases[id] || []), name] } });
  }
  function register(definition) {
    const key = JSON.stringify([definition.path.map(normalize), normalize(definition.name)]);
    const id = 'kp.' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 24);
    const existing = getPoint(id);
    if (existing) return existing;
    const point = { ...definition, id, source: 'ai', createdAt: new Date().toISOString() };
    commit({ ...state, revision: state.revision + 1, points: [...state.points, point] });
    return point;
  }
  return {
    get points() { return points(); },
    get version() { return `adaptive-v2.${state.revision}`; },
    getPoint, findByName, listForPrompt, addAlias, register,
    isValidId: (id) => Boolean(getPoint(id)),
  };
}
module.exports = { createRegistry, normalize };
