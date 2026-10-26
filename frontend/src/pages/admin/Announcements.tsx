import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../../api/client';
import type { Announcement, Paged } from '../../api/types';
import { Checkbox, ConfirmDialog, ErrorSummary, PageHeader, Pagination, QueryView, TextAreaField, TextField } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle } from '../../hooks/misc';
import { AnnouncementList } from '../shared/AnnouncementsFeed';

export default function AdminAnnouncements() {
  useDocumentTitle('Institute announcements');
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [notify, setNotify] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['announcements', 'feed', page], queryFn: () => api.get<Paged<Announcement>>(`/announcements${qs({ page, pageSize: 10 })}`) });
  const post = useMutation({
    mutationFn: () => api.post('/announcements', { title, body, notify }),
    onSuccess: () => { toast('Announcement posted to everyone'); setTitle(''); setBody(''); setConfirm(false); qc.invalidateQueries({ queryKey: ['announcements'] }); },
    onError: () => setConfirm(false),
  });
  return (
    <Page>
      <PageHeader eyebrow="Administration" title="Institute announcements" lede="Notices for every learner, trainer and administrator. Course announcements are posted by training teams." />
      <div className="columns">
        <QueryView q={q}>
          {(d) => <div className="stack"><AnnouncementList items={d.items} /><Pagination page={d.page} totalPages={d.totalPages} total={d.total} onPage={setPage} noun="announcements" /></div>}
        </QueryView>
        <aside className="panel" aria-labelledby="new-h">
          <div className="panel__head"><h2 id="new-h">New announcement</h2></div>
          <form className="panel__body stack" onSubmit={(e) => { e.preventDefault(); setConfirm(true); }}>
            <ErrorSummary error={post.error} />
            <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            <TextAreaField label="Message" value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} />
            <Checkbox label="Send an in-app notification to everyone" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            <div className="form-actions"><button className="btn btn--primary" type="submit" disabled={title.trim().length < 3 || !body.trim()}>Post to everyone</button></div>
          </form>
        </aside>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Post to the whole institute?" confirmLabel="Post" busy={post.isPending}
        onConfirm={() => post.mutate()} body={<p>“{title}” will be visible to every active account{notify ? ' and each person gets a notification' : ''}.</p>} />
    </Page>
  );
}
