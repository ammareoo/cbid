import { Link } from 'react-router-dom';
import { Page } from '../../layouts/AppShell';
import { PageHeader } from '../../components/ui';
import { useDocumentTitle } from '../../hooks/misc';

export default function NotFound() {
  useDocumentTitle('Page not found');
  return (
    <Page>
      <PageHeader title="Page not found" lede="The page may have moved, or you may not have access to it." />
      <Link className="btn btn--primary" to="/">Go to your home page</Link>
    </Page>
  );
}
