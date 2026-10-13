import * as prompts from '@clack/prompts';

export type Choice={value:string;label:string;hint?:string};
export type Spinner={start(message:string):void;stop(message:string):void;error(message:string):void;isCancelled:boolean};
export type Terminal={
  intro(message:string):void;outro(message:string):void;note(body:string,title:string):void;
  info(message:string):void;success(message:string):void;warn(message:string):void;error(message:string):void;cancel(message:string):void;
  spinner():Spinner;
  select(message:string,options:Choice[]):Promise<string|symbol>;
  multiselect(message:string,options:Choice[]):Promise<string[]|symbol>;
  text(message:string,placeholder:string,validate:(value:string)=>string|undefined):Promise<string|symbol>;
  confirm(message:string,initialValue?:boolean):Promise<boolean|symbol>;
};

/** Repository descriptions and other upstream text cannot control the terminal. */
export function plainText(value:string,max=160):string {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}

export function createTerminal(pretty=!!process.stdout.isTTY):Terminal {
  const print=(message:string)=>{process.stdout.write(`${message}\n`);};
  const promptUnavailable=async():Promise<never>=>{throw new Error('Guided setup needs a terminal. Run mergefoo connect --repo owner/name instead.');};
  if(!pretty)return {
    intro:print,outro:print,note:(body,title)=>print(`${title}\n${body}`),info:print,success:print,warn:print,
    error:message=>{process.stderr.write(`${message}\n`);},cancel:print,
    spinner:()=>({start:print,stop:print,error:print,isCancelled:false}),
    select:promptUnavailable,multiselect:promptUnavailable,text:promptUnavailable,confirm:promptUnavailable,
  };
  return {
    intro:prompts.intro,outro:prompts.outro,note:(body,title)=>prompts.note(body,title),
    info:prompts.log.info,success:prompts.log.success,warn:prompts.log.warn,error:prompts.log.error,cancel:prompts.cancel,
    spinner:()=>prompts.spinner(),
    select:(message,options)=>prompts.autocomplete({message,options,placeholder:'Type to search…',maxItems:7}),
    multiselect:(message,options)=>prompts.autocompleteMultiselect({message,options,placeholder:'Type to find a repository…',initialValues:[],required:true,maxItems:7,validate:values=>Array.isArray(values)&&values.length>50?'Choose up to 50 repositories.':undefined}),
    text:(message,placeholder,validate)=>prompts.text({message,placeholder,validate:value=>validate(value??'')}),
    confirm:(message,initialValue=true)=>prompts.confirm({message,initialValue,active:'Yes',inactive:'No'}),
  };
}

export class Cancelled extends Error {}
export function answer<T>(value:T|symbol):T {
  if(prompts.isCancel(value)||typeof value==='symbol')throw new Cancelled();return value as T;
}
