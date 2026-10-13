import {spawn} from 'node:child_process';

/** Pass a URL as one argument; never ask a shell to interpret the pairing link. */
export function openBrowser(url:string,platform=process.platform):Promise<boolean>{
  const command=platform==='darwin'?'open':platform==='win32'?'rundll32.exe':'xdg-open';
  const args=platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];
  return new Promise(resolve=>{
    const child=spawn(command,args,{stdio:'ignore',shell:false});let done=false;
    const finish=(success:boolean)=>{if(done)return;done=true;clearTimeout(timer);resolve(success);};
    const timer=setTimeout(()=>{child.kill();finish(false);},5000);
    child.once('error',()=>finish(false));child.once('exit',code=>finish(code===0));
  });
}
