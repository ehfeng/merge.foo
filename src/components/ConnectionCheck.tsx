'use client';
import {useState} from 'react';
type Result={label:string;status?:number;ok:boolean;detail:string};
const probes=[{label:'App server',path:'/api/session'},{label:'Repository protection',path:'/api/github/repositories'},{label:'PR protection',path:'/api/github/workspace?repository=connection-check%2Fprobe'}];
export default function ConnectionCheck(){
  const [results,setResults]=useState<Result[]>([]);const [busy,setBusy]=useState(false);
  async function check(){setBusy(true);setResults([]);
    const next=await Promise.all(probes.map(async probe=>{
      try{
        // Deliberately omit session cookies: this only checks public connectivity and access protection.
        const response=await fetch(probe.path,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(10000)});
        const data=await response.json();const privateHeaders=response.headers.get('cache-control')?.includes('no-store')??false;
        const ok=privateHeaders&&(probe.label==='App server'?response.status===200&&data.authenticated===false:response.status===401&&typeof data.error==='string');
        return {label:probe.label,status:response.status,ok,detail:ok?(probe.label==='App server'?'Reachable · GitHub setup '+(data.configured?'configured':'pending'):'Sign-in required · private responses are not cached'):'Unexpected response. Check the server configuration.'};
      }catch{return {label:probe.label,ok:false,detail:'Could not reach the server. Try again.'};}
    }));setResults(next);setBusy(false);
  }
  return <div className="connection-check"><button className="text-button" disabled={busy} onClick={()=>void check()}>{busy?'Checking connection…':'Check connection & access protection'}</button>{results.length>0&&<div role="status" aria-label="Connection results">{results.map(result=><div key={result.label} className={result.ok?'check-ok':'check-error'}><strong>{result.ok?'✓':'!'} {result.label}{result.status&&` · HTTP ${result.status}`}</strong><small>{result.detail}</small></div>)}</div>}</div>;
}
