import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import { generateClass, validate, umlParams, relationFieldName, STRUCTURAL } from './javaGen';
import { sampleDiagram } from './sample';
import './App.css';

const STORAGE_KEY = 'uml-diagram-v1';
const uid = () => Math.random().toString(36).slice(2, 10);
const REL_TYPES = [
  { value: 'inheritance', short: 'Extends', hint: 'Click the child class, then the parent class.' },
  { value: 'realization', short: 'Implements', hint: 'Click the class, then the interface it implements.' },
  { value: 'association', short: 'Association', hint: 'Click the owner class, then the class it refers to.' },
  { value: 'aggregation', short: 'Aggregation', hint: 'Click the whole (container), then the part.' },
  { value: 'composition', short: 'Composition', hint: 'Click the whole (owner), then the part it creates.' },
  { value: 'dependency', short: 'Dependency', hint: 'Click the class that uses, then the class it depends on.' },
];
const MULTS = ['1', '0..1', '*', '1..*'];
const VIS = [
  { v: '+', t: 'public' }, { v: '-', t: 'private' }, { v: '#', t: 'protected' }, { v: '~', t: 'package' },
];
const KEYWORDS = /(\/\/[^\n]*|"(?:[^"\\]|\\.)*"|@\w+|\b(?:package|import|public|private|protected|static|final|abstract|class|interface|extends|implements|return|void|new|this|super|int|long|double|float|boolean|char|byte|short|null|true|false)\b)/g;

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (Array.isArray(d.classes) && Array.isArray(d.relations)) return d;
    }
  } catch { /* storage unavailable */ }
  return sampleDiagram();
}

function download(content, filename, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function clip(c, s, toward) {
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (!dx && !dy) return c;
  const t = Math.min(dx ? s.w / 2 / Math.abs(dx) : Infinity, dy ? s.h / 2 / Math.abs(dy) : Infinity);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

export default function App() {
  const [diagram, setDiagram] = useState(loadInitial);
  const [selected, setSelected] = useState(null);
  const [connect, setConnect] = useState(null);
  const [tab, setTab] = useState('props');
  const [opts, setOpts] = useState({ pkg: 'com.example.model', accessors: true, constructors: true });
  const [sizes, setSizes] = useState({});
  const nodeRefs = useRef({});
  const dragRef = useRef(null);
  const fileRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(diagram)); } catch { /* ignore */ }
  }, [diagram]);

  useLayoutEffect(() => {
    const next = {};
    let changed = false;
    for (const c of diagram.classes) {
      const el = nodeRefs.current[c.id];
      if (!el) continue;
      next[c.id] = { w: el.offsetWidth, h: el.offsetHeight };
      const prev = sizes[c.id];
      if (!prev || prev.w !== next[c.id].w || prev.h !== next[c.id].h) changed = true;
    }
    if (changed || Object.keys(next).length !== Object.keys(sizes).length) setSizes(next);
  });

  const byId = (id) => diagram.classes.find((c) => c.id === id);
  const updateClass = (id, patch) =>
    setDiagram((d) => ({ ...d, classes: d.classes.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const updateRelation = (id, patch) =>
    setDiagram((d) => ({ ...d, relations: d.relations.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));

  function addClass(kind) {
    const base = kind === 'interface' ? 'NewInterface' : kind === 'abstract' ? 'AbstractClass' : 'NewClass';
    let name = base;
    for (let i = 2; diagram.classes.some((c) => c.name === name); i++) name = base + i;
    const n = diagram.classes.length % 6;
    const wrap = wrapRef.current;
    const cls = {
      id: uid(), name, kind, attributes: [], methods: [],
      x: (wrap?.scrollLeft ?? 0) + 80 + n * 30, y: (wrap?.scrollTop ?? 0) + 80 + n * 30,
    };
    setDiagram((d) => ({ ...d, classes: [...d.classes, cls] }));
    setSelected({ kind: 'class', id: cls.id });
    setTab('props');
  }

  function deleteSelected() {
    if (!selected) return;
    if (selected.kind === 'class') {
      setDiagram((d) => ({
        classes: d.classes.filter((c) => c.id !== selected.id),
        relations: d.relations.filter((r) => r.from !== selected.id && r.to !== selected.id),
      }));
    } else {
      setDiagram((d) => ({ ...d, relations: d.relations.filter((r) => r.id !== selected.id) }));
    }
    setSelected(null);
  }

  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === 'Escape') {
        setConnect(null);
        setSelected(null);
      }
      if (e.key === 'Delete' && selected) deleteSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function onNodeClick(e, cls) {
    e.stopPropagation();
    if (!connect) {
      setSelected({ kind: 'class', id: cls.id });
      return;
    }
    if (!connect.from) {
      setConnect({ ...connect, from: cls.id });
      return;
    }
    if (connect.from === cls.id) return;
    const rel = {
      id: uid(), type: connect.type, from: connect.from, to: cls.id, label: '',
      multiplicity: STRUCTURAL.includes(connect.type) ? '1' : '',
    };
    setDiagram((d) => ({ ...d, relations: [...d.relations, rel] }));
    setConnect(null);
    setSelected({ kind: 'relation', id: rel.id });
    setTab('props');
  }

  function startDrag(e, cls) {
    if (connect || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: cls.id, sx: e.clientX, sy: e.clientY, ox: cls.x, oy: cls.y };
    setSelected({ kind: 'class', id: cls.id });
  }

  function onDrag(e, cls) {
    const dr = dragRef.current;
    if (!dr || dr.id !== cls.id) return;
    const snap = (v) => Math.max(0, Math.round(v / 10) * 10);
    updateClass(cls.id, { x: snap(dr.ox + e.clientX - dr.sx), y: snap(dr.oy + e.clientY - dr.sy) });
  }

  function importJson(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    file.text().then((text) => {
      try {
        const d = JSON.parse(text);
        if (!Array.isArray(d.classes) || !Array.isArray(d.relations)) throw new Error('bad format');
        setDiagram(d);
        setSelected(null);
      } catch {
        alert('That file is not a valid diagram JSON.');
      }
    });
  }

  function resetTo(d, msg) {
    if (diagram.classes.length && !confirm(msg)) return;
    setDiagram(d);
    setSelected(null);
    setConnect(null);
  }

  function renderEdge(r) {
    const a = byId(r.from);
    const b = byId(r.to);
    if (!a || !b) return null;
    const sa = sizes[a.id] || { w: 180, h: 90 };
    const sb = sizes[b.id] || { w: 180, h: 90 };
    const ca = { x: a.x + sa.w / 2, y: a.y + sa.h / 2 };
    const cb = { x: b.x + sb.w / 2, y: b.y + sb.h / 2 };
    const p1 = clip(ca, sa, cb);
    const p2 = clip(cb, sb, ca);
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
    const ux = (p2.x - p1.x) / len;
    const uy = (p2.y - p1.y) / len;
    const dashed = r.type === 'realization' || r.type === 'dependency';
    const markerEnd = { inheritance: 'url(#tri)', realization: 'url(#tri)', association: 'url(#arrow)', dependency: 'url(#arrow)' }[r.type];
    const markerStart = { aggregation: 'url(#diamond)', composition: 'url(#diamondFilled)' }[r.type];
    const isSel = selected?.kind === 'relation' && selected.id === r.id;
    const line = { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
    const label = STRUCTURAL.includes(r.type) ? relationFieldName(diagram, r) : r.label;
    return (
      <g key={r.id} className={isSel ? 'edge selected' : 'edge'}>
        <line {...line} className="edge-line" strokeDasharray={dashed ? '7 5' : undefined} markerEnd={markerEnd} markerStart={markerStart} />
        <line
          {...line}
          className="edge-hit"
          onClick={(e) => {
            e.stopPropagation();
            setSelected({ kind: 'relation', id: r.id });
            setTab('props');
          }}
        />
        {r.multiplicity && (
          <text x={p2.x - ux * 24 - uy * 12} y={p2.y - uy * 24 + ux * 12 + 4} className="edge-text" textAnchor="middle">
            {r.multiplicity}
          </text>
        )}
        {label && (
          <text x={(p1.x + p2.x) / 2 - uy * 12} y={(p1.y + p2.y) / 2 + ux * 12 + 4} className="edge-text role" textAnchor="middle">
            {label}
          </text>
        )}
      </g>
    );
  }

  const warnings = validate(diagram);
  const selClass = selected?.kind === 'class' ? byId(selected.id) : null;
  const selRel = selected?.kind === 'relation' ? diagram.relations.find((r) => r.id === selected.id) : null;
  const width = Math.max(1800, ...diagram.classes.map((c) => c.x + 500));
  const height = Math.max(1200, ...diagram.classes.map((c) => c.y + 500));
  const connectInfo = connect && REL_TYPES.find((t) => t.value === connect.type);

  return (
    <div className="app">
      <header className="toolbar">
        <h1>UML → Java</h1>
        <div className="group">
          <span className="group-label">Add</span>
          <button onClick={() => addClass('class')}>Class</button>
          <button onClick={() => addClass('abstract')}>Abstract</button>
          <button onClick={() => addClass('interface')}>Interface</button>
        </div>
        <div className="group">
          <span className="group-label">Connect</span>
          {REL_TYPES.map((t) => (
            <button
              key={t.value}
              className={connect?.type === t.value ? 'active' : ''}
              onClick={() => setConnect(connect?.type === t.value ? null : { type: t.value, from: null })}
            >
              <RelIcon type={t.value} /> {t.short}
            </button>
          ))}
        </div>
        <div className="group">
          <button onClick={() => download(JSON.stringify(diagram, null, 2), 'diagram.json', 'application/json')}>Export JSON</button>
          <button onClick={() => fileRef.current.click()}>Import JSON</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={importJson} />
          <button onClick={() => resetTo(sampleDiagram(), 'Replace the current diagram with the sample?')}>Sample</button>
          <button className="danger" onClick={() => resetTo({ classes: [], relations: [] }, 'Clear the whole diagram?')}>Clear</button>
        </div>
      </header>

      <div className="main">
        <div className="canvas-area">
          {connect && (
            <div className="banner">
              <b>{connectInfo.short}:</b> {connect.from ? `now click the target class (source: ${byId(connect.from)?.name}).` : connectInfo.hint}
              <button onClick={() => setConnect(null)}>Cancel (Esc)</button>
            </div>
          )}
          <div className="canvas-wrap" ref={wrapRef}>
            <div
              className={`canvas${connect ? ' connecting' : ''}`}
              style={{ width, height }}
              onClick={() => setSelected(null)}
            >
              <svg className="edges" width={width} height={height}>
                <defs>
                  <marker id="tri" viewBox="0 0 20 20" refX="20" refY="10" markerWidth="18" markerHeight="18" markerUnits="userSpaceOnUse" orient="auto">
                    <path d="M0,1 L20,10 L0,19 z" fill="#fff" stroke="#334155" strokeWidth="1.5" />
                  </marker>
                  <marker id="arrow" viewBox="0 0 20 20" refX="20" refY="10" markerWidth="16" markerHeight="16" markerUnits="userSpaceOnUse" orient="auto">
                    <path d="M0,2 L20,10 L0,18" fill="none" stroke="#334155" strokeWidth="1.8" />
                  </marker>
                  <marker id="diamond" viewBox="0 0 22 12" refX="0" refY="6" markerWidth="22" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto">
                    <path d="M0,6 L11,0.8 L22,6 L11,11.2 z" fill="#fff" stroke="#334155" strokeWidth="1.5" />
                  </marker>
                  <marker id="diamondFilled" viewBox="0 0 22 12" refX="0" refY="6" markerWidth="22" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto">
                    <path d="M0,6 L11,0.8 L22,6 L11,11.2 z" fill="#334155" stroke="#334155" strokeWidth="1.5" />
                  </marker>
                </defs>
                {diagram.relations.map(renderEdge)}
              </svg>
              {diagram.classes.map((c) => (
                <ClassNode
                  key={c.id}
                  cls={c}
                  selected={selected?.kind === 'class' && selected.id === c.id}
                  isSource={connect?.from === c.id}
                  nodeRef={(el) => {
                    if (el) nodeRefs.current[c.id] = el;
                    else delete nodeRefs.current[c.id];
                  }}
                  onPointerDown={(e) => startDrag(e, c)}
                  onPointerMove={(e) => onDrag(e, c)}
                  onPointerUp={() => { dragRef.current = null; }}
                  onClick={(e) => onNodeClick(e, c)}
                />
              ))}
              {diagram.classes.length === 0 && <div className="empty">Use “Add → Class” to start your diagram.</div>}
            </div>
          </div>
        </div>

        <aside className="sidebar">
          <div className="tabs">
            <button className={tab === 'props' ? 'active' : ''} onClick={() => setTab('props')}>Properties</button>
            <button className={tab === 'code' ? 'active' : ''} onClick={() => setTab('code')}>
              Java Code {warnings.length > 0 && <span className="badge">{warnings.length}</span>}
            </button>
          </div>
          <div className="tab-body">
            {tab === 'code' ? (
              <CodePanel diagram={diagram} selectedId={selClass?.id} opts={opts} setOpts={setOpts} warnings={warnings} />
            ) : selClass ? (
              <ClassEditor cls={selClass} onChange={(p) => updateClass(selClass.id, p)} onDelete={deleteSelected} onCode={() => setTab('code')} />
            ) : selRel ? (
              <RelationEditor rel={selRel} diagram={diagram} onChange={(p) => updateRelation(selRel.id, p)} onDelete={deleteSelected} />
            ) : (
              <Overview diagram={diagram} warnings={warnings} />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function RelIcon({ type }) {
  const dashed = type === 'realization' || type === 'dependency';
  return (
    <svg width="26" height="12" viewBox="0 0 26 12" className="rel-icon">
      <line x1={type === 'aggregation' || type === 'composition' ? 10 : 1} y1="6" x2={type === 'inheritance' || type === 'realization' ? 17 : 24} y2="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray={dashed ? '3 2' : undefined} />
      {(type === 'inheritance' || type === 'realization') && <path d="M17,1 L25,6 L17,11 z" fill="none" stroke="currentColor" strokeWidth="1.3" />}
      {(type === 'association' || type === 'dependency') && <path d="M19,2 L25,6 L19,10" fill="none" stroke="currentColor" strokeWidth="1.5" />}
      {(type === 'aggregation' || type === 'composition') && (
        <path d="M1,6 L5.5,2.5 L10,6 L5.5,9.5 z" fill={type === 'composition' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" />
      )}
    </svg>
  );
}

function ClassNode({ cls, selected, isSource, nodeRef, onPointerDown, onPointerMove, onPointerUp, onClick }) {
  return (
    <div
      ref={nodeRef}
      className={`node${selected ? ' selected' : ''}${isSource ? ' source' : ''} kind-${cls.kind}`}
      style={{ left: cls.x, top: cls.y }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClick}
    >
      <div className="head">
        {cls.kind !== 'class' && <div className="stereo">«{cls.kind}»</div>}
        <div className={cls.kind === 'abstract' ? 'italic' : ''}>{cls.name || '(unnamed)'}</div>
      </div>
      <div className="section">
        {cls.attributes.map((a) => (
          <div key={a.id} className={a.isStatic ? 'underline' : ''}>
            {a.visibility} {a.name}: {a.type}{a.isFinal ? ' {final}' : ''}
          </div>
        ))}
      </div>
      <div className="section">
        {cls.methods.map((m) => (
          <div
            key={m.id}
            className={[m.isStatic && 'underline', (m.isAbstract || (cls.kind === 'interface' && !m.isStatic)) && 'italic'].filter(Boolean).join(' ')}
          >
            {m.visibility} {m.name}({umlParams(m.params)}): {m.returnType || 'void'}
          </div>
        ))}
      </div>
    </div>
  );
}

function VisSelect({ value, onChange }) {
  return (
    <select className="vis" value={value} onChange={(e) => onChange(e.target.value)} title="Visibility">
      {VIS.map((o) => <option key={o.v} value={o.v}>{o.v} {o.t}</option>)}
    </select>
  );
}

function ClassEditor({ cls, onChange, onDelete, onCode }) {
  const setList = (key, id, patch) => onChange({ [key]: cls[key].map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const removeFrom = (key, id) => onChange({ [key]: cls[key].filter((x) => x.id !== id) });
  const isIface = cls.kind === 'interface';

  return (
    <div className="editor">
      <div className="row">
        <label className="grow">Name
          <input value={cls.name} onChange={(e) => onChange({ name: e.target.value.replace(/\s/g, '') })} />
        </label>
        <label>Kind
          <select value={cls.kind} onChange={(e) => onChange({ kind: e.target.value })}>
            <option value="class">Class</option>
            <option value="abstract">Abstract class</option>
            <option value="interface">Interface</option>
          </select>
        </label>
      </div>

      <h4>
        {isIface ? 'Constants' : 'Attributes'}
        <button
          onClick={() => onChange({
            attributes: [...cls.attributes, { id: uid(), visibility: '-', name: `field${cls.attributes.length + 1}`, type: 'String', isStatic: false, isFinal: false }],
          })}
        >+ Add</button>
      </h4>
      {cls.attributes.length === 0 && <p className="muted">No attributes.</p>}
      {cls.attributes.map((a) => (
        <div className="member" key={a.id}>
          <VisSelect value={a.visibility} onChange={(v) => setList('attributes', a.id, { visibility: v })} />
          <input className="grow" value={a.name} placeholder="name" onChange={(e) => setList('attributes', a.id, { name: e.target.value.trim() })} />
          <input className="type" value={a.type} placeholder="type" onChange={(e) => setList('attributes', a.id, { type: e.target.value })} />
          <label className="chk" title="static"><input type="checkbox" checked={a.isStatic} onChange={(e) => setList('attributes', a.id, { isStatic: e.target.checked })} />S</label>
          <label className="chk" title="final"><input type="checkbox" checked={a.isFinal} onChange={(e) => setList('attributes', a.id, { isFinal: e.target.checked })} />F</label>
          <button className="icon" title="Remove" onClick={() => removeFrom('attributes', a.id)}>×</button>
        </div>
      ))}

      <h4>
        Methods
        <button
          onClick={() => onChange({
            methods: [...cls.methods, { id: uid(), visibility: '+', name: `method${cls.methods.length + 1}`, params: '', returnType: 'void', isStatic: false, isAbstract: false }],
          })}
        >+ Add</button>
      </h4>
      {cls.methods.length === 0 && <p className="muted">No methods.</p>}
      {cls.methods.map((m) => (
        <div className="member method" key={m.id}>
          <div className="row">
            <VisSelect value={m.visibility} onChange={(v) => setList('methods', m.id, { visibility: v })} />
            <input className="grow" value={m.name} placeholder="name" onChange={(e) => setList('methods', m.id, { name: e.target.value.trim() })} />
            <input className="type" value={m.returnType} placeholder="return" onChange={(e) => setList('methods', m.id, { returnType: e.target.value })} />
            <label className="chk" title="static"><input type="checkbox" checked={m.isStatic} onChange={(e) => setList('methods', m.id, { isStatic: e.target.checked })} />S</label>
            {!isIface && (
              <label className="chk" title="abstract"><input type="checkbox" checked={m.isAbstract} onChange={(e) => setList('methods', m.id, { isAbstract: e.target.checked })} />A</label>
            )}
            <button className="icon" title="Remove" onClick={() => removeFrom('methods', m.id)}>×</button>
          </div>
          <input value={m.params} placeholder="parameters, e.g. String name, int age" onChange={(e) => setList('methods', m.id, { params: e.target.value })} />
        </div>
      ))}

      <p className="muted small">S = static, F = final, A = abstract. Drag the box on the canvas to move it.</p>
      <div className="row">
        <button className="primary" onClick={onCode}>View Java code</button>
        <button className="danger" onClick={onDelete}>Delete class</button>
      </div>
    </div>
  );
}

function RelationEditor({ rel, diagram, onChange, onDelete }) {
  const from = diagram.classes.find((c) => c.id === rel.from);
  const to = diagram.classes.find((c) => c.id === rel.to);
  const structural = STRUCTURAL.includes(rel.type);
  const info = REL_TYPES.find((t) => t.value === rel.type);
  return (
    <div className="editor">
      <h3>Relationship</h3>
      <p className="rel-path"><b>{from?.name}</b> <RelIcon type={rel.type} /> <b>{to?.name}</b></p>
      <label>Type
        <select
          value={rel.type}
          onChange={(e) => onChange({ type: e.target.value, multiplicity: STRUCTURAL.includes(e.target.value) ? rel.multiplicity || '1' : '' })}
        >
          {REL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.short}</option>)}
        </select>
      </label>
      <p className="muted small">{info.hint}</p>
      {structural && (
        <>
          <label>Multiplicity (at {to?.name})
            <select value={rel.multiplicity || '1'} onChange={(e) => onChange({ multiplicity: e.target.value })}>
              {MULTS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          <label>Field / role name
            <input value={rel.label} placeholder={relationFieldName(diagram, { ...rel, label: '' })} onChange={(e) => onChange({ label: e.target.value.trim() })} />
          </label>
          <p className="muted small">Generates a field in {from?.name}: <code>{(rel.multiplicity === '*' || rel.multiplicity === '1..*') ? `List<${to?.name}>` : to?.name} {relationFieldName(diagram, rel)}</code></p>
        </>
      )}
      {rel.type === 'dependency' && (
        <label>Label
          <input value={rel.label} placeholder="e.g. uses" onChange={(e) => onChange({ label: e.target.value })} />
        </label>
      )}
      <div className="row">
        <button onClick={() => onChange({ from: rel.to, to: rel.from })}>⇄ Swap direction</button>
        <button className="danger" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

function Overview({ diagram, warnings }) {
  return (
    <div className="editor">
      <h3>How to use</h3>
      <ol className="steps">
        <li><b>Add</b> a class, abstract class or interface from the toolbar.</li>
        <li>Click a box to edit its name, attributes and methods here.</li>
        <li>Pick a <b>Connect</b> type, then click the source and the target class.</li>
        <li>Open <b>Java Code</b> to see, copy or download the generated source.</li>
      </ol>
      <p className="muted small">Drag boxes to move them. Del removes the selection, Esc cancels. Your diagram is saved in this browser automatically.</p>
      <p><b>{diagram.classes.length}</b> classes · <b>{diagram.relations.length}</b> relationships</p>
      <Warnings warnings={warnings} />
    </div>
  );
}

function Warnings({ warnings }) {
  if (!warnings.length) return <p className="ok">✓ Diagram is valid Java.</p>;
  return (
    <div className="warnings">
      <b>Design warnings</b>
      <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
    </div>
  );
}

function highlight(code) {
  return code.split(KEYWORDS).map((part, i) => {
    if (i % 2 === 0) return part;
    const cls = part.startsWith('//') ? 'tok-comment' : part.startsWith('"') ? 'tok-string' : part.startsWith('@') ? 'tok-anno' : 'tok-kw';
    return <span key={i} className={cls}>{part}</span>;
  });
}

function CodePanel({ diagram, selectedId, opts, setOpts, warnings }) {
  const [pick, setPick] = useState(selectedId);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (selectedId) setPick(selectedId); }, [selectedId]);
  const cls = diagram.classes.find((c) => c.id === pick) || diagram.classes[0];
  const code = cls ? generateClass(diagram, cls, opts) : '';

  async function downloadAll() {
    const zip = new JSZip();
    const folder = opts.pkg ? zip.folder(opts.pkg.replace(/\./g, '/')) : zip;
    for (const c of diagram.classes) folder.file(`${c.name}.java`, generateClass(diagram, c, opts));
    download(await zip.generateAsync({ type: 'blob' }), 'java-src.zip');
  }

  function copy() {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }

  return (
    <div className="editor code-panel">
      <div className="row">
        <label className="grow">Package
          <input value={opts.pkg} placeholder="(default package)" onChange={(e) => setOpts({ ...opts, pkg: e.target.value.trim() })} />
        </label>
      </div>
      <div className="row">
        <label className="chk"><input type="checkbox" checked={opts.constructors} onChange={(e) => setOpts({ ...opts, constructors: e.target.checked })} /> Constructors</label>
        <label className="chk"><input type="checkbox" checked={opts.accessors} onChange={(e) => setOpts({ ...opts, accessors: e.target.checked })} /> Getters / setters</label>
      </div>
      {warnings.length > 0 && <Warnings warnings={warnings} />}
      {!cls ? (
        <p className="muted">Add a class to generate code.</p>
      ) : (
        <>
          <div className="row">
            <select className="grow" value={cls.id} onChange={(e) => setPick(e.target.value)}>
              {diagram.classes.map((c) => <option key={c.id} value={c.id}>{c.name}.java</option>)}
            </select>
            <button onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
            <button onClick={() => download(code, `${cls.name}.java`)}>.java</button>
          </div>
          <pre className="code">{highlight(code)}</pre>
          <button className="primary" onClick={downloadAll}>Download all classes (.zip)</button>
        </>
      )}
    </div>
  );
}
