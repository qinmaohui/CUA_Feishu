import { FlaskConical } from 'lucide-react';
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@renderer/components/ui/sidebar';

export function NavBatchTest({ onClick }: { onClick: () => void }) {
  const { state } = useSidebar();

  return (
    <SidebarGroup>
      <SidebarMenu className="items-center">
        <SidebarMenuItem className="w-full">
          <SidebarMenuButton
            className="font-medium !pr-2"
            tooltip="Batch Test"
            onClick={onClick}
          >
            <FlaskConical strokeWidth={2} />
            <span className={state === 'collapsed' ? 'sr-only' : undefined}>
              Batch Test
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
