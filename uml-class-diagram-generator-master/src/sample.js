const attr = (id, visibility, name, type, isStatic = false, isFinal = false) => ({ id, visibility, name, type, isStatic, isFinal });
const method = (id, visibility, name, params, returnType, isAbstract = false, isStatic = false) => ({ id, visibility, name, params, returnType, isAbstract, isStatic });

export function sampleDiagram() {
  return {
    classes: [
      { id: 'company', name: 'Company', kind: 'class', x: 60, y: 40, attributes: [attr('a1', '-', 'name', 'String')], methods: [] },
      {
        id: 'payable', name: 'Payable', kind: 'interface', x: 430, y: 40, attributes: [],
        methods: [method('m1', '+', 'calculatePay', '', 'double')],
      },
      {
        id: 'department', name: 'Department', kind: 'class', x: 60, y: 260,
        attributes: [attr('a2', '-', 'name', 'String')],
        methods: [method('m2', '+', 'getHeadCount', '', 'int')],
      },
      {
        id: 'employee', name: 'Employee', kind: 'abstract', x: 410, y: 240,
        attributes: [attr('a3', '-', 'id', 'int'), attr('a4', '-', 'name', 'String'), attr('a5', '#', 'baseSalary', 'double')],
        methods: [method('m3', '+', 'getDetails', '', 'String')],
      },
      {
        id: 'manager', name: 'Manager', kind: 'class', x: 270, y: 500,
        attributes: [attr('a6', '-', 'bonus', 'double')],
        methods: [method('m4', '+', 'approveLeave', 'int days', 'boolean')],
      },
      {
        id: 'developer', name: 'Developer', kind: 'class', x: 590, y: 500,
        attributes: [attr('a7', '-', 'language', 'String')],
        methods: [method('m5', '+', 'writeCode', 'String feature', 'void')],
      },
    ],
    relations: [
      { id: 'r1', type: 'composition', from: 'company', to: 'department', multiplicity: '1..*', label: 'departments' },
      { id: 'r2', type: 'aggregation', from: 'department', to: 'employee', multiplicity: '*', label: 'employees' },
      { id: 'r3', type: 'realization', from: 'employee', to: 'payable', multiplicity: '', label: '' },
      { id: 'r4', type: 'inheritance', from: 'manager', to: 'employee', multiplicity: '', label: '' },
      { id: 'r5', type: 'inheritance', from: 'developer', to: 'employee', multiplicity: '', label: '' },
    ],
  };
}
