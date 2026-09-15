const fields = { DEEPSEEK_API_KEY:'key', DEEPSEEK_MODEL:'model', DEEPSEEK_API_URL:'url', BAIDU_OCR_API_KEY:'ocrKey', BAIDU_OCR_SECRET_KEY:'ocrSecret' };
document.getElementById('preview').addEventListener('click',()=>window.desktopSettings.preview());
window.desktopSettings.read().then(config=>{
  document.getElementById('model').value=config.model;
  document.getElementById('url').value=config.url;
  if(config.hasKey) document.getElementById('key').placeholder='已保存（留空保留）';
}).catch(()=>{document.getElementById('status').textContent='读取配置失败，请重新打开程序。';});
document.getElementById('settings').addEventListener('submit',async e=>{
  e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;
  try{const values=Object.fromEntries(Object.entries(fields).map(([k,id])=>[k,document.getElementById(id).value.trim()]));const r=await window.desktopSettings.save(values);document.getElementById('status').textContent=r.message || '';}
  catch(e){document.getElementById('status').textContent=e.message;}
  finally{button.disabled=false;}
});
