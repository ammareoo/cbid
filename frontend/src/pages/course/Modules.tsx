import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, EyeOff, FileText, Link2, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { api } from '../../api/client';
import type { CourseModule, ModuleItem } from '../../api/types';
import { Badge, Checkbox, ConfirmDialog, Dialog, EmptyState, ErrorSummary, PublishBadge, QueryView, SectionTitle, SelectField, TextAreaField, TextField } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useDocumentTitle } from '../../hooks/misc';
import { formatBytes } from '../../utils/format';
import { useCourse } from './CourseLayout';

const KIND = { page: { label: 'Reading', icon: FileText }, link: { label: 'External link', icon: Link2 }, file: { label: 'File', icon: Upload } };

function ModuleDialog({ courseId, module, open, onClose }: { courseId: string; module?: CourseModule; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState(module?.title ?? '');
  const [description, setDescription] = useState(module?.description ?? '');
  const [published, setPublished] = useState(module?.published ?? false);
  const m = useMutation({
    mutationFn: () => module
      ? api.patch(`/modules/${module.id}`, { title, description, published })
      : api.post(`/courses/${courseId}/modules`, { title, description, published }),
    onSuccess: () => { toast(module ? 'Module saved' : 'Module added'); qc.invalidateQueries({ queryKey: ['modules', courseId] }); onClose(); },
  });
  return (
    <Dialog open={open} onClose={onClose} title={module ? 'Edit module' : 'Add a module'}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <ErrorSummary error={m.error} />
        <TextField label="Module title" hint='For example "Week 2 · Rights and barriers".' value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={160} autoFocus />
        <TextAreaField label="Short description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        <Checkbox label="Published" hint="Learners only see published modules." checked={published} onChange={(e) => setPublished(e.target.checked)} />
        <div className="form-actions"><button className="btn btn--primary" type="submit" disabled={m.isPending || title.trim().length < 2}>Save module</button><button type="button" className="btn btn--secondary" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  );
}

function ItemDialog({ courseId, moduleId, item, open, onClose }: { courseId: string; moduleId: string; item?: ModuleItem & { body?: string | null }; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<ModuleItem['kind']>(item?.kind ?? 'page');
  const [title, setTitle] = useState(item?.title ?? '');
  const [body, setBody] = useState(item?.body ?? '');
  const [url, setUrl] = useState(item?.url ?? 'https://');
  const [fileId, setFileId] = useState<string | null>(item?.fileId ?? null);
  const [fileName, setFileName] = useState<string | null>(item?.fileName ?? null);
  const [minutes, setMinutes] = useState(item?.estimatedMinutes ? String(item.estimatedMinutes) : '');
  const [published, setPublished] = useState(item?.published ?? false);
  const upload = useMutation({
    mutationFn: (f: File) => api.upload<{ id: string; originalName: string }>(`/courses/${courseId}/files?purpose=material`, f),
    onSuccess: (r) => { setFileId(r.id); setFileName(r.originalName); if (!title) setTitle(r.originalName.replace(/\.[^.]+$/, '')); },
  });
  const save = useMutation({
    mutationFn: () => {
      const payload = { title, body: kind === 'page' ? body : null, url: kind === 'link' ? url : null, fileId: kind === 'file' ? fileId : null,
        published, estimatedMinutes: minutes ? Number(minutes) : null };
      return item ? api.patch(`/items/${item.id}`, payload) : api.post(`/modules/${moduleId}/items`, { kind, ...payload });
    },
    onSuccess: () => { toast(item ? 'Item saved' : 'Item added'); qc.invalidateQueries({ queryKey: ['modules', courseId] }); qc.invalidateQueries({ queryKey: ['item'] }); onClose(); },
  });
  return (
    <Dialog open={open} onClose={onClose} title={item ? 'Edit item' : 'Add learning material'} wide>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <ErrorSummary error={save.error ?? upload.error} />
        {!item && (
          <SelectField label="Type" value={kind} onChange={(e) => setKind(e.target.value as ModuleItem['kind'])}>
            <option value="page">Reading page (written in Markdown)</option>
            <option value="link">External link</option>
            <option value="file">File (PDF, slides, document, audio or video)</option>
          </SelectField>
        )}
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
        {kind === 'page' && <TextAreaField label="Content" hint="Markdown: ## heading, **bold**, - list, [link](https://…). Write descriptive link text." value={body} onChange={(e) => setBody(e.target.value)} className="textarea--tall" />}
        {kind === 'link' && <TextField label="Web address" type="url" hint="Must start with https://" value={url} onChange={(e) => setUrl(e.target.value)} />}
        {kind === 'file' && (
          <div className="field">
            <label htmlFor="material-file">File</label>
            <p className="hint" id="material-file-hint">Up to 25 MB. Prefer accessible formats: tagged PDF, Word, captioned video.</p>
            <input id="material-file" type="file" aria-describedby="material-file-hint" accept=".pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg,.webp,.txt,.md,.csv,.mp4,.mp3"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); }} />
            {upload.isPending && <p className="meta" role="status">Uploading…</p>}
            {fileName && <p className="meta" role="status"><Check aria-hidden="true" width={14} height={14} /> Attached: {fileName}</p>}
          </div>
        )}
        <TextField label="Estimated time in minutes (optional)" type="number" min={1} max={600} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        <Checkbox label="Published" hint="Visible to learners when the module is also published." checked={published} onChange={(e) => setPublished(e.target.checked)} />
        <div className="form-actions"><button className="btn btn--primary" type="submit" disabled={save.isPending || upload.isPending}>Save</button><button type="button" className="btn btn--secondary" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  );
}

export default function Modules() {
  const { course, isStaff } = useCourse();
  useDocumentTitle(`Content · ${course.code}`);
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['modules', course.id], queryFn: () => api.get<{ modules: CourseModule[]; writable: boolean }>(`/courses/${course.id}/modules`) });
  const [moduleDialog, setModuleDialog] = useState<{ module?: CourseModule } | null>(null);
  const [itemDialog, setItemDialog] = useState<{ moduleId: string; item?: ModuleItem & { body?: string | null } } | null>(null);
  const [deleting, setDeleting] = useState<{ kind: 'module' | 'item'; id: string; title: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['modules', course.id] });

  const move = useMutation({
    mutationFn: ({ kind, id, direction }: { kind: 'modules' | 'items'; id: string; direction: 'up' | 'down'; label: string }) => api.post(`/${kind}/${id}/move`, { direction }),
    onSuccess: (_r, v) => { refresh(); toast(`Moved ${v.label} ${v.direction}`); },
  });
  const remove = useMutation({
    mutationFn: (d: { kind: 'module' | 'item'; id: string }) => api.del(d.kind === 'module' ? `/modules/${d.id}` : `/items/${d.id}`),
    onSuccess: () => { refresh(); toast('Deleted'); setDeleting(null); },
    onError: (e: Error) => { toast(e.message, 'error'); setDeleting(null); },
  });
  const togglePublish = useMutation({
    mutationFn: ({ kind, id, published }: { kind: 'modules' | 'items'; id: string; published: boolean }) => api.patch(`/${kind}/${id}`, { published }),
    onSuccess: refresh,
  });
  const editItem = async (it: ModuleItem) => {
    const full = await api.get<ModuleItem & { body: string | null }>(`/items/${it.id}`);
    setItemDialog({ moduleId: it.moduleId, item: full });
  };
  const editable = isStaff && course.writable;

  return (
    <>
      <SectionTitle title="Course content" lede={isStaff ? 'Organise the course into modules. Use the arrow buttons to reorder; learners see published items only.' : 'Work through the modules in order. Tick items off as you finish them.'}
        actions={editable && <button type="button" className="btn btn--primary" onClick={() => setModuleDialog({})}><Plus aria-hidden="true" />Add module</button>} />
      <QueryView q={q}>
        {(d) => d.modules.length === 0 ? <EmptyState title="No content yet">{isStaff ? 'Add a module to start building the course.' : 'Your trainer has not published any modules yet.'}</EmptyState> : (
          <ol className="route" aria-label="Modules">
            {d.modules.map((m, mi) => {
              const done = m.items.filter((i) => i.completed).length;
              return (
                <li key={m.id} className="route-module">
                  <div className="route-module__head">
                    <div className="stack-sm">
                      <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: '1.2rem' }}>{m.title}</h3>
                      {m.description && <p className="muted">{m.description}</p>}
                    </div>
                    <div className="row">
                      {isStaff ? <PublishBadge status={m.published ? 'published' : 'draft'} />
                        : m.items.length > 0 && <Badge tone={done === m.items.length ? 'ok' : 'outline'}>{done} of {m.items.length} done</Badge>}
                      {editable && (
                        <>
                          <button type="button" className="icon-btn" aria-label={`Move ${m.title} up`} disabled={mi === 0} onClick={() => move.mutate({ kind: 'modules', id: m.id, direction: 'up', label: m.title })}><ArrowUp aria-hidden="true" /></button>
                          <button type="button" className="icon-btn" aria-label={`Move ${m.title} down`} disabled={mi === d.modules.length - 1} onClick={() => move.mutate({ kind: 'modules', id: m.id, direction: 'down', label: m.title })}><ArrowDown aria-hidden="true" /></button>
                          <button type="button" className="icon-btn" aria-label={`Edit ${m.title}`} onClick={() => setModuleDialog({ module: m })}><Pencil aria-hidden="true" /></button>
                          <button type="button" className="icon-btn" aria-label={`Delete ${m.title}`} onClick={() => setDeleting({ kind: 'module', id: m.id, title: m.title })}><Trash2 aria-hidden="true" /></button>
                        </>
                      )}
                    </div>
                  </div>
                  <ol className="route-items">
                    {m.items.map((it, ii) => {
                      const K = KIND[it.kind];
                      return (
                        <li key={it.id} className="route-item">
                          {isStaff ? <K.icon aria-hidden="true" width={20} height={20} color="var(--muted)" />
                            : <span className={`route-item__dot${it.completed ? ' route-item__dot--done' : ''}`} aria-hidden="true">{it.completed && <Check />}</span>}
                          <div className="stack-sm" style={{ minWidth: 0 }}>
                            <Link to={`/courses/${course.id}/items/${it.id}`}>{it.title}{it.completed && <span className="sr-only"> (completed)</span>}</Link>
                            <span className="meta">
                              <span className="row" style={{ gap: 4 }}><K.icon aria-hidden="true" width={14} height={14} />{K.label}</span>
                              {it.estimatedMinutes && <span>{it.estimatedMinutes} min</span>}
                              {it.fileSize ? <span>{formatBytes(it.fileSize)}</span> : null}
                              {isStaff && !it.published && <Badge tone="warn" icon={<EyeOff aria-hidden="true" />}>Hidden</Badge>}
                            </span>
                          </div>
                          {editable ? (
                            <div className="row" style={{ gap: 0 }}>
                              <button type="button" className="icon-btn" aria-label={`Move ${it.title} up`} disabled={ii === 0} onClick={() => move.mutate({ kind: 'items', id: it.id, direction: 'up', label: it.title })}><ArrowUp aria-hidden="true" /></button>
                              <button type="button" className="icon-btn" aria-label={`Move ${it.title} down`} disabled={ii === m.items.length - 1} onClick={() => move.mutate({ kind: 'items', id: it.id, direction: 'down', label: it.title })}><ArrowDown aria-hidden="true" /></button>
                              <button type="button" className="btn btn--ghost btn--sm" onClick={() => togglePublish.mutate({ kind: 'items', id: it.id, published: !it.published })}>{it.published ? 'Hide' : 'Publish'}<span className="sr-only"> {it.title}</span></button>
                              <button type="button" className="icon-btn" aria-label={`Edit ${it.title}`} onClick={() => editItem(it)}><Pencil aria-hidden="true" /></button>
                              <button type="button" className="icon-btn" aria-label={`Delete ${it.title}`} onClick={() => setDeleting({ kind: 'item', id: it.id, title: it.title })}><Trash2 aria-hidden="true" /></button>
                            </div>
                          ) : <span />}
                        </li>
                      );
                    })}
                    {m.items.length === 0 && <li className="route-item"><span /><span className="muted">No items in this module yet.</span><span /></li>}
                  </ol>
                  {editable && (
                    <div style={{ padding: '0 var(--s-5) var(--s-4)' }}>
                      <button type="button" className="btn btn--secondary btn--sm" onClick={() => setItemDialog({ moduleId: m.id })}><Plus aria-hidden="true" />Add material<span className="sr-only"> to {m.title}</span></button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </QueryView>
      {moduleDialog && <ModuleDialog courseId={course.id} module={moduleDialog.module} open onClose={() => setModuleDialog(null)} />}
      {itemDialog && <ItemDialog courseId={course.id} moduleId={itemDialog.moduleId} item={itemDialog.item} open onClose={() => setItemDialog(null)} />}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} danger confirmLabel="Delete" busy={remove.isPending}
        title={`Delete “${deleting?.title ?? ''}”?`} onConfirm={() => deleting && remove.mutate(deleting)}
        body={<p>{deleting?.kind === 'module' ? 'The module and every item in it will be removed. Learner progress on those items is also removed.' : 'Learners will no longer see this item.'} This cannot be undone.</p>} />
    </>
  );
}
