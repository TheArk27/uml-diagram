const VIS_WORD = { '+': 'public', '-': 'private', '#': 'protected', '~': '' };
export const STRUCTURAL = ['association', 'aggregation', 'composition'];
const IMPORTS = {
  List: 'java.util.List', ArrayList: 'java.util.ArrayList', Map: 'java.util.Map', HashMap: 'java.util.HashMap',
  Set: 'java.util.Set', HashSet: 'java.util.HashSet', Date: 'java.util.Date', Optional: 'java.util.Optional',
  LocalDate: 'java.time.LocalDate', LocalDateTime: 'java.time.LocalDateTime', BigDecimal: 'java.math.BigDecimal',
};
const IDENT = /^[A-Za-z_$][\w$]*$/;
const I = '    ';

export const isMany = (m) => ['*', '1..*', '0..*'].includes(m);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);

// Splits "Map<String, Integer> m, int x" without breaking on commas inside generics.
export function splitParams(params) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of params || '') {
    if (ch === '<') depth++;
    else if (ch === '>') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p, i) => {
      const at = p.lastIndexOf(' ');
      return at < 0 ? { type: p, name: `arg${i}` } : { type: p.slice(0, at).trim(), name: p.slice(at + 1) };
    });
}

export const umlParams = (params) => splitParams(params).map((p) => `${p.name}: ${p.type}`).join(', ');

export function defaultValue(type) {
  switch (type) {
    case 'boolean': return 'false';
    case 'char': return "'\\0'";
    case 'byte': case 'short': case 'int': return '0';
    case 'long': return '0L';
    case 'float': return '0.0f';
    case 'double': return '0.0';
    default: return 'null';
  }
}

const find = (d, id) => d.classes.find((c) => c.id === id);
const targets = (d, cls, type) =>
  d.relations.filter((r) => r.from === cls.id && r.type === type).map((r) => find(d, r.to)).filter(Boolean);
const sig = (m) => `${m.name}(${splitParams(m.params).map((p) => p.type).join(',')})`;

export function relationFieldName(d, rel) {
  const t = find(d, rel.to);
  if (!t) return '';
  return rel.label?.trim() || lowerFirst(t.name) + (isMany(rel.multiplicity) ? 's' : '');
}

export function fieldsOf(d, cls) {
  const own = cls.attributes.map((a) => ({ ...a, many: false }));
  const names = new Set(own.map((a) => a.name));
  const fromRelations = d.relations
    .filter((r) => r.from === cls.id && STRUCTURAL.includes(r.type))
    .map((r) => {
      const t = find(d, r.to);
      if (!t) return null;
      const many = isMany(r.multiplicity);
      return {
        id: r.id, visibility: '-', name: relationFieldName(d, r), type: many ? `List<${t.name}>` : t.name,
        elem: t.name, many, isStatic: false, isFinal: false, relType: r.type, multiplicity: r.multiplicity || '1',
      };
    })
    .filter((f) => f && !names.has(f.name));
  return [...own, ...fromRelations];
}

const superClass = (d, cls) => targets(d, cls, 'inheritance').find((t) => t.kind !== 'interface');

function interfacesOf(d, cls) {
  const all = [...targets(d, cls, 'inheritance'), ...targets(d, cls, 'realization')].filter((t) => t.kind === 'interface');
  return [...new Set(all.map((t) => t.name))];
}

// Constructor fields: everything the parent constructor needs (passed to super) + own fields.
function ctorFields(d, cls, seen = new Set()) {
  if (seen.has(cls.id)) return { inherited: [], own: [] };
  seen.add(cls.id);
  const own = fieldsOf(d, cls).filter((f) => !f.isStatic && !f.many);
  const p = superClass(d, cls);
  const parent = p ? ctorFields(d, p, seen) : { inherited: [], own: [] };
  return { inherited: [...parent.inherited, ...parent.own], own };
}

// Abstract methods from parents/interfaces that a concrete class still has to implement.
function inheritedAbstract(d, cls) {
  if (cls.kind !== 'class') return [];
  const have = new Set(cls.methods.map(sig));
  const out = [];
  const seen = new Set();
  const visit = (c) => {
    const rels = d.relations
      .filter((r) => r.from === c.id && (r.type === 'inheritance' || r.type === 'realization'))
      .sort((a, b) => (a.type === 'inheritance' ? 0 : 1) - (b.type === 'inheritance' ? 0 : 1));
    for (const r of rels) {
      const p = find(d, r.to);
      if (!p || seen.has(p.id)) continue;
      seen.add(p.id);
      for (const m of p.methods) {
        const k = sig(m);
        if (have.has(k)) continue;
        have.add(k);
        const isAbstract = p.kind === 'interface' ? !m.isStatic : m.isAbstract;
        if (isAbstract) out.push(m);
      }
      visit(p);
    }
  };
  visit(cls);
  return out;
}

function importsFor(texts) {
  const set = new Set();
  for (const t of texts) for (const w of (t || '').match(/[A-Za-z_]\w*/g) || []) if (IMPORTS[w]) set.add(IMPORTS[w]);
  return [...set].sort();
}

export function generateClass(d, cls, opts = {}) {
  const { pkg = '', accessors = true, constructors = true } = opts;
  const isIface = cls.kind === 'interface';
  const fields = fieldsOf(d, cls);
  const stubs = inheritedAbstract(d, cls);
  const userSigs = new Set(cls.methods.map(sig));
  const body = [];
  const blank = () => body.length && body.push('');
  const stubBody = (ret) => [`${I}${I}// TODO: implement`, ...(ret === 'void' ? [] : [`${I}${I}return ${defaultValue(ret)};`])];

  let header;
  if (isIface) {
    const ext = interfacesOf(d, cls);
    header = `public interface ${cls.name}${ext.length ? ` extends ${ext.join(', ')}` : ''}`;
  } else {
    const sup = superClass(d, cls);
    const impl = interfacesOf(d, cls);
    header = `public ${cls.kind === 'abstract' ? 'abstract ' : ''}class ${cls.name}`
      + (sup ? ` extends ${sup.name}` : '')
      + (impl.length ? ` implements ${impl.join(', ')}` : '');
  }

  // Fields
  if (isIface) {
    for (const f of fields.filter((f) => !f.relType)) body.push(`${I}${f.type} ${f.name} = ${defaultValue(f.type)};`);
  } else {
    for (const f of fields) {
      const mods = [VIS_WORD[f.visibility], f.isStatic && 'static', f.isFinal && 'final'].filter(Boolean).join(' ');
      const init = f.many ? ' = new ArrayList<>()' : f.isStatic && f.isFinal ? ` = ${defaultValue(f.type)}` : '';
      const note = f.relType ? ` // ${f.relType} (${f.multiplicity})` : '';
      body.push(`${I}${mods ? `${mods} ` : ''}${f.type} ${f.name}${init};${note}`);
    }
  }

  // Constructors
  if (constructors && !isIface) {
    const { inherited, own } = ctorFields(d, cls);
    const all = [...inherited, ...own];
    if (!own.some((f) => f.isFinal) || all.length === 0) {
      blank();
      body.push(`${I}public ${cls.name}() {`, `${I}}`);
    }
    if (all.length) {
      blank();
      body.push(`${I}public ${cls.name}(${all.map((f) => `${f.type} ${f.name}`).join(', ')}) {`);
      if (inherited.length) body.push(`${I}${I}super(${inherited.map((f) => f.name).join(', ')});`);
      for (const f of own) body.push(`${I}${I}this.${f.name} = ${f.name};`);
      body.push(`${I}}`);
    }
  }

  // Getters / setters for private instance fields
  if (accessors && !isIface) {
    for (const f of fields.filter((f) => !f.isStatic && f.visibility === '-')) {
      const C = cap(f.name);
      const getter = `${f.type === 'boolean' ? 'is' : 'get'}${C}`;
      if (!userSigs.has(`${getter}()`)) {
        blank();
        body.push(`${I}public ${f.type} ${getter}() {`, `${I}${I}return ${f.name};`, `${I}}`);
      }
      if (f.many) {
        const p = lowerFirst(f.elem);
        blank();
        body.push(`${I}public void add${f.elem}(${f.elem} ${p}) {`, `${I}${I}${f.name}.add(${p});`, `${I}}`);
      } else if (!f.isFinal && !userSigs.has(`set${C}(${f.type})`)) {
        blank();
        body.push(`${I}public void set${C}(${f.type} ${f.name}) {`, `${I}${I}this.${f.name} = ${f.name};`, `${I}}`);
      }
    }
  }

  // Methods
  const emit = (m, override) => {
    const params = splitParams(m.params).map((p) => `${p.type} ${p.name}`).join(', ');
    const ret = m.returnType?.trim() || 'void';
    blank();
    if (override) body.push(`${I}@Override`);
    if (isIface) {
      if (m.isStatic) body.push(`${I}static ${ret} ${m.name}(${params}) {`, ...stubBody(ret), `${I}}`);
      else body.push(`${I}${ret} ${m.name}(${params});`);
      return;
    }
    const isAbstract = !override && m.isAbstract;
    const mods = [override ? 'public' : VIS_WORD[m.visibility], m.isStatic && 'static', isAbstract && 'abstract']
      .filter(Boolean).join(' ');
    const head = `${I}${mods ? `${mods} ` : ''}${ret} ${m.name}(${params})`;
    if (isAbstract) body.push(`${head};`);
    else body.push(`${head} {`, ...stubBody(ret), `${I}}`);
  };
  cls.methods.forEach((m) => emit(m, false));
  stubs.forEach((m) => emit(m, true));

  const texts = [...fields.map((f) => f.type), ...[...cls.methods, ...stubs].flatMap((m) => [m.returnType, m.params])];
  if (!isIface && fields.some((f) => f.many)) texts.push('ArrayList');
  const imports = importsFor(texts);

  const out = [];
  if (pkg) out.push(`package ${pkg};`, '');
  if (imports.length) out.push(...imports.map((i) => `import ${i};`), '');
  out.push(`${header} {`, ...body, '}', '');
  return out.join('\n');
}

export function validate(d) {
  const w = [];
  const names = new Set();
  for (const c of d.classes) {
    if (!IDENT.test(c.name)) w.push(`"${c.name || '(empty)'}" is not a valid Java class name.`);
    if (names.has(c.name)) w.push(`Duplicate class name "${c.name}".`);
    names.add(c.name);
    const supers = targets(d, c, 'inheritance');
    const realized = targets(d, c, 'realization');
    if (c.kind === 'interface') {
      if ([...supers, ...realized].some((s) => s.kind !== 'interface')) w.push(`Interface ${c.name} cannot extend or implement a class.`);
    } else {
      if (supers.filter((s) => s.kind !== 'interface').length > 1) w.push(`${c.name} extends more than one class (Java allows only one).`);
      if (supers.some((s) => s.kind === 'interface')) w.push(`${c.name} "extends" an interface - generated as implements.`);
      for (const t of realized) if (t.kind !== 'interface') w.push(`${c.name} implements ${t.name}, which is not an interface.`);
      if (c.kind === 'class' && c.methods.some((m) => m.isAbstract)) w.push(`${c.name} has abstract methods but is not abstract.`);
    }
    for (const m of [...c.attributes, ...c.methods]) if (!IDENT.test(m.name)) w.push(`${c.name}: "${m.name}" is not a valid identifier.`);
  }
  const state = {};
  let cycle = false;
  const dfs = (id) => {
    state[id] = 1;
    for (const r of d.relations) {
      if (r.from !== id || (r.type !== 'inheritance' && r.type !== 'realization')) continue;
      if (state[r.to] === 1) cycle = true;
      else if (!state[r.to]) dfs(r.to);
    }
    state[id] = 2;
  };
  d.classes.forEach((c) => !state[c.id] && dfs(c.id));
  if (cycle) w.push('Inheritance cycle detected.');
  return w;
}
