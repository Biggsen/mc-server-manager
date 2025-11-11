import { Link } from 'react-router-dom'
import { ContentSection } from '../components/layout'

function NotFound() {
  return (
    <ContentSection as="section">
      <header>
        <h2>Page not found</h2>
      </header>
      <p className="empty-state">
        We couldn’t find that route. Head back to the{' '}
        <Link to="/" className="inline-link">
          dashboard
        </Link>{' '}
        to keep building.
      </p>
    </ContentSection>
  )
}

export default NotFound

