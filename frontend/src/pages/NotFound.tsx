import { Link } from 'react-router-dom'
import { Anchor, Stack, Text, Title } from '@mantine/core'
import { Card, CardContent } from '../components/ui'

function NotFound() {
  return (
    <Stack gap="lg" p="lg" align="center" justify="center" style={{ minHeight: '60vh' }}>
      <Card>
        <CardContent>
          <Stack gap="md" align="center">
            <Title order={2}>Page not found</Title>
            <Text size="sm" c="dimmed" ta="center">
              We couldn't find that route. Head back to the{' '}
              <Anchor component={Link} to="/">
                dashboard
              </Anchor>{' '}
              to keep building.
            </Text>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  )
}

export default NotFound

