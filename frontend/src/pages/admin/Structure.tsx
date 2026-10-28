import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, CalendarRange, Plus, Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import { EmptyState, ErrorSummary, PageHeader, QueryView, TextField } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDate } from '../../utils/format';
import { useDepartments } from './Users';
import { useTerms } from './Courses';

export default function AdminStructure() {
  useDocumentTitle('Programme areas & terms');
  const qc = useQueryClient();
  const toast = useToast();
  const depts = useDepartments();
  const terms = useTerms();
  const [dept, setDept] = useState({ code: '', name: '' });
  const [term, setTerm] = useState({ code: '', name: '', startsOn: '', endsOn: '' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin'] });
  const addDept = useMutation({
    mutationFn: () => api.post('/admin/departments', { ...dept, code: dept.code.toUpperCase() }),
    onSuccess: () => { toast('Programme area added'); setDept({ code: '', name: '' }); refresh(); },
  });
  const addTerm = useMutation({
    mutationFn: () => api.post('/admin/terms', { ...term, code: term.code.toUpperCase() }),
    onSuccess: () => { toast('Term added'); setTerm({ code: '', name: '', startsOn: '', endsOn: '' }); refresh(); },
  });
  const del = useMutation({
    mutationFn: ({ kind, id }: { kind: 'departments' | 'terms'; id: string }) => api.del(`/admin/${kind}/${id}`),
    onSuccess: () => { toast('Removed'); refresh(); },
    onError: (e: Error) => toast(e.message.includes('linked') ? 'This is still used by courses and cannot be removed.' : e.message, 'error'),
  });

  return (
    <Page>
      <div className="structure-page-wrap">
        <PageHeader
          title="Programme areas & terms"
          lede="Organise courses by area, and set the teaching calendar."
        />
        <div className="structure-page">
          <section className="structure-panel" aria-labelledby="d-h">
            <header className="structure-panel__head">
              <div className="structure-panel__icon" aria-hidden="true"><Building2 width={18} height={18} /></div>
              <div>
                <h2 id="d-h">Programme areas</h2>
                <p>Group related courses.</p>
              </div>
            </header>
            <div className="structure-panel__body">
              <QueryView q={depts}>
                {(d) => d.items.length === 0 ? (
                  <EmptyState title="No programme areas yet">Add the first area below.</EmptyState>
                ) : (
                  <ul className="structure-tiles" aria-label="Programme areas">
                    {d.items.map((x) => (
                      <li key={x.id} className="structure-tile">
                        <div className="structure-tile__main">
                          <span className="code-tag">{x.code}</span>
                          <p className="structure-tile__title">{x.name}</p>
                        </div>
                        <div className="structure-tile__aside">
                          <span className="structure-tile__stat">
                            <span className="structure-tile__stat-value">{x.courseCount}</span>
                            <span className="structure-tile__stat-label">{x.courseCount === 1 ? 'course' : 'courses'}</span>
                          </span>
                          <button
                            type="button"
                            className="icon-btn structure-tile__remove"
                            aria-label={`Remove ${x.name}`}
                            disabled={x.courseCount > 0 || del.isPending}
                            title={x.courseCount > 0 ? 'Still used by courses' : 'Remove'}
                            onClick={() => del.mutate({ kind: 'departments', id: x.id })}
                          >
                            <Trash2 aria-hidden="true" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </QueryView>
              <form className="structure-form" onSubmit={(e) => { e.preventDefault(); addDept.mutate(); }} noValidate>
                <p className="structure-form__title"><Plus aria-hidden="true" width={14} height={14} /> Add programme area</p>
                <ErrorSummary error={addDept.error} />
                <div className="form-grid">
                  <TextField label="Code" hint="2–10 letters or digits" value={dept.code} onChange={(e) => setDept({ ...dept, code: e.target.value })} />
                  <TextField label="Name" value={dept.name} onChange={(e) => setDept({ ...dept, name: e.target.value })} />
                </div>
                <div className="form-actions">
                  <button className="btn btn--primary" type="submit" disabled={addDept.isPending}>
                    {addDept.isPending ? 'Adding…' : 'Add area'}
                  </button>
                </div>
              </form>
            </div>
          </section>

          <section className="structure-panel" aria-labelledby="t-h">
            <header className="structure-panel__head">
              <div className="structure-panel__icon structure-panel__icon--teal" aria-hidden="true"><CalendarRange width={18} height={18} /></div>
              <div>
                <h2 id="t-h">Terms</h2>
                <p>Teaching calendar windows.</p>
              </div>
            </header>
            <div className="structure-panel__body">
              <QueryView q={terms}>
                {(d) => d.items.length === 0 ? (
                  <EmptyState title="No terms yet">Add the first term below.</EmptyState>
                ) : (
                  <ul className="structure-tiles" aria-label="Terms">
                    {d.items.map((x) => (
                      <li key={x.id} className="structure-tile">
                        <div className="structure-tile__main">
                          <span className="code-tag">{x.code}</span>
                          <p className="structure-tile__title">{x.name}</p>
                          <p className="structure-tile__dates">
                            {formatDate(x.startsOn)} – {formatDate(x.endsOn)}
                          </p>
                        </div>
                        <div className="structure-tile__aside">
                          <span className="structure-tile__stat">
                            <span className="structure-tile__stat-value">{x.courseCount}</span>
                            <span className="structure-tile__stat-label">{x.courseCount === 1 ? 'course' : 'courses'}</span>
                          </span>
                          <button
                            type="button"
                            className="icon-btn structure-tile__remove"
                            aria-label={`Remove ${x.name}`}
                            disabled={x.courseCount > 0 || del.isPending}
                            title={x.courseCount > 0 ? 'Still used by courses' : 'Remove'}
                            onClick={() => del.mutate({ kind: 'terms', id: x.id })}
                          >
                            <Trash2 aria-hidden="true" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </QueryView>
              <form className="structure-form" onSubmit={(e) => { e.preventDefault(); addTerm.mutate(); }} noValidate>
                <p className="structure-form__title"><Plus aria-hidden="true" width={14} height={14} /> Add term</p>
                <ErrorSummary error={addTerm.error} />
                <div className="form-grid">
                  <TextField label="Code" hint="e.g. 2027-AUT" value={term.code} onChange={(e) => setTerm({ ...term, code: e.target.value })} />
                  <TextField label="Name" hint="e.g. Autumn 2027" value={term.name} onChange={(e) => setTerm({ ...term, name: e.target.value })} />
                  <TextField label="Starts" type="date" value={term.startsOn} onChange={(e) => setTerm({ ...term, startsOn: e.target.value })} />
                  <TextField label="Ends" type="date" value={term.endsOn} onChange={(e) => setTerm({ ...term, endsOn: e.target.value })} />
                </div>
                <div className="form-actions">
                  <button className="btn btn--primary" type="submit" disabled={addTerm.isPending}>
                    {addTerm.isPending ? 'Adding…' : 'Add term'}
                  </button>
                </div>
              </form>
            </div>
          </section>
        </div>
      </div>
    </Page>
  );
}
