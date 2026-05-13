import { Map } from 'lucide-react';

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@renderer/components/ui/sidebar';

export function NavUIMap({ onClick }: { onClick: () => void }) {
  return (
    <SidebarGroup>
      <SidebarMenu className="items-center">
        <SidebarMenuItem className="w-full flex flex-col items-center">
          <SidebarMenuButton className="font-medium" onClick={onClick}>
            <Map strokeWidth={2} />
            <span>UI Map</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
