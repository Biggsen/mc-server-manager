import { useState } from 'react'
import { Stack, Group, Text, Title, Divider, Code } from '@mantine/core'
import { Button, Badge, Tabs, TabList, TabTrigger, TabPanels, TabPanel, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Skeleton } from '../components/ui'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '../components/ui/card'
import { Package, RocketLaunch } from '@phosphor-icons/react'

function Styleguide() {
  const [loading, setLoading] = useState(false)

  return (
    <Stack gap="xl" p="lg">
      <Stack gap={4}>
        <Title order={1}>Style Guide</Title>
        <Text size="sm" c="dimmed">
          A comprehensive guide to the UI components available in this application.
        </Text>
      </Stack>

      <Divider />

      <Card>
        <CardHeader>
          <CardTitle>Buttons</CardTitle>
          <CardDescription>Button component with multiple variants and sizes</CardDescription>
        </CardHeader>
        <CardContent>
          <Stack gap="md">
            <Stack gap="xs">
              <Text size="sm" fw={600}>
                Variants
              </Text>
              <Group>
                <Button variant="primary">Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="pill">Pill</Button>
                <Button variant="link">Link</Button>
                <Button variant="danger">Danger</Button>
              </Group>
            </Stack>

            <Stack gap="xs">
              <Text size="sm" fw={600}>
                Sizes
              </Text>
              <Group>
                <Button size="sm">Small</Button>
                <Button size="md">Medium</Button>
                <Button size="lg">Large</Button>
              </Group>
            </Stack>

            <Stack gap="xs">
              <Text size="sm" fw={600}>
                With Icons
              </Text>
              <Group>
                <Button icon={<Package size={18} weight="fill" aria-hidden="true" />}>With Icon</Button>
                <Button
                  icon={<RocketLaunch size={18} weight="fill" aria-hidden="true" />}
                  iconPosition="right"
                >
                  Icon Right
                </Button>
              </Group>
            </Stack>

            <Stack gap="xs">
              <Text size="sm" fw={600}>
                States
              </Text>
              <Group>
                <Button loading={loading} onClick={() => setLoading(!loading)}>
                  {loading ? 'Loading...' : 'Click to Load'}
                </Button>
                <Button disabled>Disabled</Button>
              </Group>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Badges</CardTitle>
          <CardDescription>Badge component for labels and status indicators</CardDescription>
        </CardHeader>
        <CardContent>
          <Stack gap="xs">
            <Group>
              <Badge variant="default">Default</Badge>
              <Badge variant="accent">Accent</Badge>
              <Badge variant="success">Success</Badge>
              <Badge variant="warning">Warning</Badge>
              <Badge variant="danger">Danger</Badge>
              <Badge variant="outline">Outline</Badge>
            </Group>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cards</CardTitle>
          <CardDescription>Card component with header, content, and footer sections</CardDescription>
        </CardHeader>
        <CardContent>
          <Stack gap="md">
            <Card>
              <CardHeader>
                <CardTitle>Card Title</CardTitle>
                <CardDescription>This is a card description</CardDescription>
              </CardHeader>
              <CardContent>
                <Text>This is the main content area of the card.</Text>
              </CardContent>
              <CardFooter>
                <Group justify="flex-end" w="100%">
                  <Button variant="ghost">Cancel</Button>
                  <Button variant="primary">Action</Button>
                </Group>
              </CardFooter>
            </Card>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tabs</CardTitle>
          <CardDescription>Tab component for organizing content</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="first">
            <TabList>
              <TabTrigger value="first">First Tab</TabTrigger>
              <TabTrigger value="second">Second Tab</TabTrigger>
              <TabTrigger value="third">Third Tab</TabTrigger>
            </TabList>
            <TabPanels>
              <TabPanel value="first">
                <Text mt="md">Content for the first tab</Text>
              </TabPanel>
              <TabPanel value="second">
                <Text mt="md">Content for the second tab</Text>
              </TabPanel>
              <TabPanel value="third">
                <Text mt="md">Content for the third tab</Text>
              </TabPanel>
            </TabPanels>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tables</CardTitle>
          <CardDescription>Table component for displaying structured data</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Version</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Project Alpha</TableCell>
                <TableCell>
                  <Badge variant="success">Active</Badge>
                </TableCell>
                <TableCell>1.21.1</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Project Beta</TableCell>
                <TableCell>
                  <Badge variant="warning">Pending</Badge>
                </TableCell>
                <TableCell>1.20.4</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Project Gamma</TableCell>
                <TableCell>
                  <Badge variant="danger">Error</Badge>
                </TableCell>
                <TableCell>1.19.2</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Skeletons</CardTitle>
          <CardDescription>Skeleton component for loading states</CardDescription>
        </CardHeader>
        <CardContent>
          <Stack gap="md">
            <Skeleton height={20} radius="md" />
            <Skeleton height={20} radius="md" width="80%" />
            <Skeleton height={20} radius="md" width="60%" />
            <Group>
              <Skeleton height={50} width={50} radius="md" />
              <Stack gap="xs" flex={1}>
                <Skeleton height={16} radius="md" />
                <Skeleton height={12} radius="md" width="70%" />
              </Stack>
            </Group>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Typography</CardTitle>
          <CardDescription>Text styles and headings</CardDescription>
        </CardHeader>
        <CardContent>
          <Stack gap="md">
            <Stack gap={4}>
              <Title order={1}>Heading 1</Title>
              <Title order={2}>Heading 2</Title>
              <Title order={3}>Heading 3</Title>
              <Title order={4}>Heading 4</Title>
              <Title order={5}>Heading 5</Title>
              <Title order={6}>Heading 6</Title>
            </Stack>
            <Divider />
            <Stack gap={4}>
              <Text size="xs">Extra small text</Text>
              <Text size="sm">Small text</Text>
              <Text size="md">Medium text (default)</Text>
              <Text size="lg">Large text</Text>
              <Text size="xl">Extra large text</Text>
            </Stack>
            <Divider />
            <Stack gap={4}>
              <Text c="dimmed">Dimmed text</Text>
              <Text fw={400}>Regular weight</Text>
              <Text fw={600}>Semi-bold weight</Text>
              <Text fw={700}>Bold weight</Text>
            </Stack>
            <Divider />
            <Code>Inline code example</Code>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  )
}

export default Styleguide

