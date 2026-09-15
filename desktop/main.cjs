const { app, BrowserWindow, Menu, ipcMain, dialog, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const root = path.join(__dirname, '..');
const smokeFile = process.argv.find(a=>a.startsWith('--smoke-output='))?.slice('--smoke-output='.length);
if(smokeFile) app.setPath('userData',path.join(path.dirname(smokeFile),'desktop-smoke-profile'));
let mainWindow, settingsWindow, server, origin, config={}, quitting=false;
const configPath = () => path.join(app.getPath('userData'),'api-settings.enc');
const settingsURL = pathToFileURL(path.join(__dirname,'settings.html')).href;
function readConfig(){
  if(fs.existsSync(configPath())) config=JSON.parse(safeStorage.decryptString(fs.readFileSync(configPath())));
}
function saveConfig(next){
  if(!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法加密保存配置。');
  fs.mkdirSync(app.getPath('userData'),{recursive:true});
  const temp=configPath()+'.tmp';fs.writeFileSync(temp,safeStorage.encryptString(JSON.stringify(next)));fs.renameSync(temp,configPath());config=next;
}
function trustedSettings(event){if(event.sender !== settingsWindow?.webContents || event.senderFrame.url !== settingsURL) throw new Error('不允许的配置请求');}
function openSettings(){
  if(settingsWindow){settingsWindow.focus();return;}
  settingsWindow=new BrowserWindow({icon:path.join(__dirname,'icon.ico'),width:660,height:800,title:'连接 AI · EL学习助手',show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  settingsWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  settingsWindow.webContents.on('will-navigate',(e,url)=>{if(url!==settingsURL)e.preventDefault();});
  settingsWindow.once('ready-to-show',async()=>{
    if(!smokeFile)settingsWindow.show();
    else if(process.argv.includes('--smoke-settings')){
      try{await settingsWindow.webContents.executeJavaScript(`window.desktopSettings.save({DEEPSEEK_API_KEY:'sk-desktop-smoke-test-only',DEEPSEEK_MODEL:'deepseek-flash',DEEPSEEK_API_URL:'https://api.deepseek.com/chat/completions'})`);}
      catch(error){fs.writeFileSync(smokeFile,JSON.stringify({error:error.message}));quitting=true;app.quit();}
    }
  });settingsWindow.on('closed',()=>{settingsWindow=null;});settingsWindow.loadFile(path.join(__dirname,'settings.html'));
}
async function startWorkspace(){
  Object.assign(process.env,config);
  process.env.KNOWLEDGE_REGISTRY_PATH=path.join(app.getPath('userData'),'knowledge-registry.json');
  // The desktop owns a private loopback port, independent of the development server.
  const express=require('express');const host=express();
  host.use((req,res,next)=>{
    if(req.headers.origin && req.headers.origin!==origin)return res.sendStatus(403);
    if(req.headers['sec-fetch-site']==='cross-site')return res.sendStatus(403);
    next();
  });
  host.use(express.static(path.join(root,'frontend/build')));
  host.use(require(path.join(root,'backend/server')).createApp());
  server=await new Promise((resolve,reject)=>{const s=host.listen(0,'127.0.0.1',()=>resolve(s));s.once('error',reject);});
  origin=`http://127.0.0.1:${server.address().port}`;
  mainWindow=new BrowserWindow({icon:path.join(__dirname,'icon.ico'),width:1380,height:900,minWidth:880,minHeight:650,title:'EL学习助手',show:false,backgroundColor:'#f5f8f8',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  mainWindow.webContents.on('will-navigate',(e,url)=>{if(new URL(url).origin!==origin)e.preventDefault();});
  mainWindow.on('close',e=>{
    if(quitting || smokeFile)return;
    const count=require(path.join(root,'backend/repositories/conversationRepository')).listConversationSummaries().length;
    if(count && dialog.showMessageBoxSync(mainWindow,{type:'question',buttons:['取消','退出'],defaultId:0,cancelId:0,message:'退出会清空本次学习记录',detail:'当前版本的题目、报告与训练保存在内存中。确定退出吗？'})!==1)e.preventDefault();
  });
  mainWindow.once('ready-to-show',()=>{if(!smokeFile)mainWindow.show();});
  await mainWindow.loadURL(origin);
  if(smokeFile){
    const data=await mainWindow.webContents.executeJavaScript(`({title:document.title,text:document.body.innerText,canvas:document.querySelectorAll('canvas').length})`);
    const response=await fetch(origin+'/api/conversations');
    const {prepareScene,evaluateScene}=require(path.join(root,'frontend/src/utils/parameterScene.mjs'));
    const m=prepareScene({points:[{x:0}],interaction:{version:1,parameters:[{id:'t',label:'位置',min:0,max:1,step:.1,initial:0}],bindings:[{path:'points.0.x',expr:'4*t'}]}});
    let live;
    if(process.argv.includes('--smoke-live')){
      const created=await (await fetch(origin+'/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();
      const answer=await (await fetch(origin+`/api/conversations/${created._id}/message`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'圆锥底面半径3，高6，求平行于底面的截面面积随高度h的关系，并提供可拖动截面高度的交互图形。'})})).json();
      const scene=answer.stepResults?.find(s=>s.drawingData?.interaction);
      live={steps:answer.stepResults?.length,interactive:!!scene};
      if(!scene)throw new Error('打包后的真实请求未生成交互图形');
      prepareScene(scene.drawingData);
    }
    fs.writeFileSync(smokeFile,JSON.stringify({packaged:app.isPackaged,frontend:data,api:response.status,parameter:evaluateScene(m,{t:1}).data.points[0].x,node:process.versions.node,encryptedSettings:fs.existsSync(configPath()),live},null,2));
    quitting=true;app.quit();
  }
}
ipcMain.handle('settings:read',event=>{trustedSettings(event);return {hasKey:!!config.DEEPSEEK_API_KEY,model:config.DEEPSEEK_MODEL || 'deepseek-flash',url:config.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions'};});
ipcMain.handle('settings:preview',async event=>{trustedSettings(event);if(!server)await startWorkspace();else mainWindow?.show();settingsWindow?.close();});
ipcMain.handle('settings:save',async(event,values)=>{
  trustedSettings(event);const next={...config};
  for(const key of ['DEEPSEEK_API_KEY','DEEPSEEK_MODEL','DEEPSEEK_API_URL','BAIDU_OCR_API_KEY','BAIDU_OCR_SECRET_KEY'])if(typeof values?.[key]==='string' && values[key].trim()){if(values[key].length>2048)throw new Error('配置内容过长');next[key]=values[key].trim();}
  if(!next.DEEPSEEK_API_KEY)throw new Error('请填写 DeepSeek API 密钥。');
  if(new URL(next.DEEPSEEK_API_URL).protocol!=='https:')throw new Error('API 地址须使用 HTTPS。');
  if(server){const result=await dialog.showMessageBox(settingsWindow,{type:'question',buttons:['取消','保存并重启'],defaultId:0,cancelId:0,message:'更改连接需要重启程序',detail:'重启会清空本次题目、报告与训练记录。'});if(result.response!==1)return {message:'未保存，当前连接保持不变。'};}
  saveConfig(next);
  if(server){quitting=true;app.relaunch();app.quit();}else{await startWorkspace();settingsWindow?.close();}
  return {message:'已保存'};
});
if(!app.requestSingleInstanceLock()){app.quit();}else{
  app.on('second-instance',()=>{const win=mainWindow || settingsWindow;if(win?.isMinimized())win.restore();win?.focus();});
  app.whenReady().then(async()=>{
    Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'EL学习助手',submenu:[{label:'AI 连接设置',click:openSettings},{type:'separator'},{role:'quit',label:'退出'}]},{label:'视图',submenu:[{role:'reload',label:'刷新'},{role:'resetZoom',label:'实际大小'},{role:'zoomIn',label:'放大'},{role:'zoomOut',label:'缩小'}]}]));
    readConfig();if(process.argv.includes('--smoke-settings'))openSettings();else if(config.DEEPSEEK_API_KEY || smokeFile)await startWorkspace();else openSettings();
  }).catch(error=>{if(smokeFile)fs.writeFileSync(smokeFile,JSON.stringify({error:error.stack}));else dialog.showErrorBox('启动失败',error.message);quitting=true;app.quit();});
}
app.on('window-all-closed',()=>app.quit());
app.on('will-quit',()=>server?.close());
