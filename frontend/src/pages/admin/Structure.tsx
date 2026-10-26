import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import { ErrorSummary, PageHeader, QueryView, TextField } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDate } from '../../utils/format';
import { useDepartments } from './Users';
import { useTerms } from './Courses';

export default function AdminStructure() {
  useDocumentTitle('Programme areas and terms');
  const qc = useQueryClient();
  const toast = useToast();
  const depts = useDepartments();
  const terms = useTerms();
  const [dept, setDept] = useState({ code: '', name: '' });
  const [term, setTerm] = useState({ code: '', name: '', startsOn: '', endsOn: '' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin'] });
  const addDept = useMutation({ mutationFn: () => api.post('/admin/departments', { ...dept, code: dept.code.toUpperCase() }), onSuccess: () => { toast('Programme area added'); setDept({ code: '', name: '' }); refresh(); } });
  const addTerm = useMutation({ mutationFn: () => api.post('/admin/terms', { ...term, code: term.code.toUpperCase() }), onSuccess: () => { toast('Term added'); setTerm({ code: '', name: '', startsOn: '', endsOn: '' }); refresh(); } });
  const del = useMutation({
    mutationFn: ({ kind, id }: { kind: 'departments' | 'terms'; id: string }) => api.del(`/admin/${kind}/${id}`),
    onSuccess: () => { toast('Removed'); refresh(); },
    onError: (e: Error) => toast(e.message.includes('linked') ? 'This is still used by courses and cannot be removed.' : e.message, 'error'),
  });

  return (
    <Page>
      <PageHeader eyebrow="Administration" title="Programme areas and terms" lede="The academic structure courses belong to. Items in use by courses cannot be removed." />
      <div className="columns columns--even">
        <section className="panel" aria-labelledby="d-h">
          <div className="panel__head"><h2 id="d-h">Programme areas</h2></div>
          <div className="panel__body stack">
            <QueryView q={depts}>{(d) => (
              <ul className="list">{d.items.map((x) => (
                <li key={x.id} className="list-item" style={{ alignItems: 'center' }}>
                  <span><span className="code-tag">{x.code}</span> {x.name}<br /><span className="meta">{x.courseCount} courses</span></span>
                  <button type="button" className="icon-btn" aria-label={`Remove ${x.name}`} disabled={x.courseCount > 0} onClick={() => del.mutate({ kind: 'departments', id: x.id })}><Trash2 aria-hidden="true" /></button>
                </li>
              ))}</ul>
            )}</QueryView>
            <form className="stack" onSubmit={(e) => { e.preventDefault(); addDept.mutate(); }} noValidate>
              <h3>Add a programme area</h3>
              <ErrorSummary error={addDept.error} />
              <div className="form-grid">
                <TextField label="Code" hint="2–10 letters or digits" value={dept.code} onChange={(e) => setDept({ ...dept, code: e.target.value })} />
                <TextField label="Name" value={dept.name} onChange={(e) => setDept({ ...dept, name: e.target.value })} />
              </div>
              <div><button className="btn btn--primary" type="submit" disabled={addDept.isPending}>Add programme area</button></div>
            </form>
          </div>
        </section>
        <section className="panel" aria-labelledby="t-h">
          <div className="panel__head"><h2 id="t-h">Terms</h2></div>
          <div className="panel__body stack">
            <QueryView q={terms}>{(d) => (
              <ul className="list">{d.items.map((x) => (
                <li key={x.id} className="list-item" style={{ alignItems: 'center' }}>
                  <span><strong>{x.name}</strong> <span className="code-tag">{x.code}</span><br /><span className="meta">{formatDate(x.startsOn)} – {formatDate(x.endsOn)} · {x.courseCount} courses</span></span>
                  <button type="button" className="icon-btn" aria-label={`Remove ${x.name}`} disabled={x.courseCount > 0} onClick={() => del.mutate({ kind: 'terms', id: x.id })}><Trash2 aria-hidden="true" /></button>
                </li>
              ))}</ul>
            )}</QueryView>
            <form className="stack" onSubmit={(e) => { e.preventDefault(); addTerm.mutate(); }} noValidate>
              <h3>Add a term</h3>
              <ErrorSummary error={addTerm.error} />
              <div className="form-grid">
                <TextField label="Code" hint="e.g. 2027-AUT" value={term.code} onChange={(e) => setTerm({ ...term, code: e.target.value })} />
                <TextField label="Name" hint="e.g. Autumn 2027" value={term.name} onChange={(e) => setTerm({ ...term, name: e.target.value })} />
                <TextField label="Starts" type="date" value={term.startsOn} onChange={(e) => setTerm({ ...term, startsOn: e.target.value })} />
                <TextField label="Ends" type="date" value={term.endsOn} onChange={(e) => setTerm({ ...term, endsOn: e.target.value })} />
              </div>
              <div><button className="btn btn--primary" type="submit" disabled={addTerm.isPending}>Add term</button></div>
            </form>
          </div>
        </section>
      </div>
    </Page>
  );
}
