const {app,BrowserWindow,ipcMain,dialog,screen}=require('electron');const path=require('node:path');const {isTrustedUrl}=require('./src/desktop-policy.cjs');
app.setName('DoreumiV98');app.setPath('userData',path.join(app.getPath('appData'),'DoreumiV98'));let win,service,readyTimer;const smoke=process.argv.includes('--smoke');
if(!app.requestSingleInstanceLock())app.quit();else app.whenReady().then(async()=>{try{
 const {startServer}=await import('./serve.mjs');service=await startServer(0);const area=screen.getPrimaryDisplay().workArea;const width=470,height=Math.min(760,area.height-30);
 win=new BrowserWindow({width,height,x:area.x+area.width-width-20,y:area.y+area.height-height-10,frame:false,transparent:true,resizable:false,alwaysOnTop:true,show:false,hasShadow:false,backgroundColor:'#00000000',title:'도름이 V98',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
 const trusted=e=>e.sender===win?.webContents&&e.senderFrame===win.webContents.mainFrame;
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(e,u)=>{if(!isTrustedUrl(u,service.url))e.preventDefault();});
 ipcMain.on('pet-close',e=>{if(trusted(e))app.quit();});ipcMain.on('pet-ready',(e,result)=>{if(!trusted(e))return;if(result?.loaded!==true||result.version!=='V98'||result.modelSha256!==service.manifest.model.sha256)return fail(new Error('V60 준비 검증 실패'));clearTimeout(readyTimer);if(!smoke)win.showInactive();console.log('V98_READY',JSON.stringify(result));});
 readyTimer=setTimeout(()=>fail(new Error('도름이 로딩 시간 초과')),90000);win.webContents.on('render-process-gone',(_e,d)=>fail(new Error('렌더러 종료: '+d.reason)));await win.loadURL(service.url+'/desktop');
 }catch(e){fail(e);}});
function fail(e){console.error('V98_START_FAILED',e.message);if(!smoke)dialog.showErrorBox('도름이 V98 실행 실패',e.message);app.exit(1);}
app.on('window-all-closed',()=>app.quit());app.on('before-quit',()=>{clearTimeout(readyTimer);service?.server.close();});
