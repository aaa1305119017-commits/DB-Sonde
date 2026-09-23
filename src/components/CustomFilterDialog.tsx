import { useState } from "react";
import { ClipboardPaste } from "lucide-react";
import { readClipboardText } from "../lib/clipboard";
import type { FilterOp } from "./ResultGrid";

export default function CustomFilterDialog({ column, op, onApply, onClose }: { column: string; op: FilterOp; onApply: (value: string) => void; onClose: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  return <div className="modal-backdrop" onMouseDown={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
    <form className="modal" role="dialog" aria-modal="true" aria-labelledby="custom-filter-title" style={{ width: 440 }} onMouseDown={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();onApply(value);}} onKeyDown={e=>{e.stopPropagation();if(e.key==="Escape")onClose();if(e.key==="Enter"&&(e.nativeEvent.isComposing||e.nativeEvent.keyCode===229))e.preventDefault();}}>
      <div className="modal-head"><h3 id="custom-filter-title">自定义筛选</h3></div>
      <div className="modal-body"><label htmlFor="custom-filter-value" className="mono">{column} {op === "like" ? "LIKE" : op}</label>
        <input id="custom-filter-value" className="input" autoFocus autoComplete="off" value={value} onChange={e=>setValue(e.target.value)} style={{width:"100%",marginTop:10}}/>
        {op==="like"&&<p className="muted">按包含匹配，输入要查找的内容即可。</p>}
        {error&&<p role="alert" style={{color:"var(--red)"}}>{error}</p>}
      </div>
      <div className="modal-foot"><button className="btn" type="button" onClick={()=>{void readClipboardText().then(setValue).catch(()=>setError("无法读取剪贴板，请手动输入"));}}><ClipboardPaste size={14}/>剪贴板</button><span style={{flex:1}}/><button className="btn" type="button" onClick={onClose}>取消</button><button className="btn primary" type="submit">确定</button></div>
    </form>
  </div>;
}
