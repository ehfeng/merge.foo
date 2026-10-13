'use client';
import {useState} from 'react';
import {Terminal,Unplug} from 'lucide-react';
import {parseCompanionUrl,type CompanionPairing} from '../companion/client';

export default function CompanionConnection({pairing,pending,ready,onConnect,onDisconnect}:{pairing:CompanionPairing|null;pending:CompanionPairing|null;ready:boolean;onConnect:(pairing:CompanionPairing)=>void;onDisconnect:()=>void}) {
  const [expanded,setExpanded]=useState(false);const [url,setUrl]=useState('');const [error,setError]=useState('');
  const origin=ready?window.location.origin:'https://merge.foo';const command=`pnpm companion --repo kernel/kernel${origin==='https://merge.foo'?'':` --origin ${origin}`}`;
  function connect(){const next=pending??parseCompanionUrl(url.trim());if(!next){setError('Paste the full pairing URL printed by the companion.');return;}setError('');setUrl('');setExpanded(false);onConnect(next);}
  const manual=<><label>Pairing URL<input aria-label="Pairing URL" type="password" autoComplete="off" placeholder="Paste the URL from your terminal" value={url} onChange={event=>setUrl(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')connect();}}/></label><button className="button primary" onClick={connect}>Connect local GitHub CLI</button>{error&&<p role="alert">{error}</p>}</>;
  return <div className="companion-connection">
    {pairing?<><strong><Terminal size={14}/>Local GitHub CLI</strong><p>Your GitHub credential stays on this device. Personal plans are saved here. The map checks for updates every minute while the helper runs; close PR details to resume map updates.</p><button className="button subtle" onClick={onDisconnect}><Unplug size={14}/>Disconnect local GitHub CLI</button><button className="text-button" onClick={()=>onConnect(pairing)}>Retry local connection</button><button className="text-button" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>Use a new pairing URL</button>{expanded&&manual}</>:<>
      <button className="button subtle companion-start" disabled={!ready} aria-expanded={expanded||!!pending} onClick={()=>setExpanded(v=>!v)}><Terminal size={15}/>Use GitHub CLI</button>
      {(expanded||pending)&&<div className="companion-instructions"><p>Connect through your existing GitHub CLI login, with access to repositories your account can use.</p><p>In the merge.foo checkout, run:</p><code>{command}</code><p>Open the pairing URL from the terminal, then connect here. Allow local-network access if your browser asks. Keep the helper running for updates and review actions.</p>{pending?<button className="button primary" onClick={connect}>Connect local GitHub CLI</button>:manual}<small>Your GitHub credential stays on your device. Plans are personal and saved on this device.</small></div>}
    </>}
  </div>;
}
