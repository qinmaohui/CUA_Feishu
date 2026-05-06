import { FlaskConical } from 'lucide-react';
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@renderer/components/ui/sidebar';

export function NavBatchTest({ onClick }: { onClick: () => void }) {
  return (
    <SidebarGroup>
      <SidebarMenu className="items-center">
        <SidebarMenuItem className="w-full flex flex-col items-center">
          <SidebarMenuButton className="font-medium" onClick={onClick}>
            <FlaskConical strokeWidth={2} />
            <span>Batch Test</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
