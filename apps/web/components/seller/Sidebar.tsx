"use client";

import {
  useCallback,
  useState,
  useEffect,
  useSyncExternalStore,
} from "react";
import {
  LogOut,
  SquarePen,
  Search,
  Settings,
  Store,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  MoreHorizontal,
  Pencil,
  Archive,
  User,
  LayoutDashboard,
  Users,
} from "lucide-react";
import { cn, isMac } from "@/lib/utils";
import { useChats, chatStore, type Chat } from "@/lib/chat-store";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sidebar as DsSidebar,
  SidebarHeader,
  SidebarBody as DsSidebarBody,
  SidebarFooter,
  SidebarItem,
} from "@/components/ui/sidebar";
import { MenuItem } from "@/components/ui/menu-item";
import { IconButton } from "@/components/ui/icon-button";
import { Text } from "@/components/ui/text";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const SIDEBAR_PREF_KEY = "sidebar-pref";
const SIDEBAR_NARROW_QUERY = "(max-width: 1023px)";

type SidebarPref = "auto" | "collapsed" | "expanded";

function subscribeNarrow(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(SIDEBAR_NARROW_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const getNarrowSnapshot = () =>
  window.matchMedia(SIDEBAR_NARROW_QUERY).matches;
const getNarrowServerSnapshot = () => false;

interface ChatItemCtx {
  activeTaskId?: string | null;
  menuOpenChatId: string | null;
  renamingChatId: string | null;
  onNavigateToTask?: (id: string) => void;
  onUpdateChat?: (
    id: string,
    data: { title?: string; archive?: boolean; unarchive?: boolean },
  ) => void;
  setRenamingChatId: (id: string | null) => void;
  setMenuOpenChatId: (id: string | null) => void;
}

function ChatRow({ chat, ctx }: { chat: Chat; ctx: ChatItemCtx }) {
  const isActive = ctx.activeTaskId === chat.id;
  const isRenaming = ctx.renamingChatId === chat.id;

  return (
    <div
      className={cn(
        "group/chat relative flex items-center rounded-lg transition-colors",
        isActive
          ? "bg-accent"
          : ctx.menuOpenChatId === chat.id
            ? "bg-muted"
            : "hover:bg-muted",
      )}
      onContextMenu={(e) => {
        e.preventDefault();
        ctx.setMenuOpenChatId(chat.id);
      }}
    >
      {isRenaming ? (
        <input
          autoFocus
          defaultValue={chat.title ?? ""}
          className="flex-1 min-w-0 px-3 py-[6px] text-sm text-foreground bg-transparent outline-none rounded-lg"
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            const val = e.currentTarget.value.trim();
            if (val && val !== chat.title) {
              ctx.onUpdateChat?.(chat.id, { title: val });
            }
            ctx.setRenamingChatId(null);
            ctx.setMenuOpenChatId(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "Escape") {
              ctx.setRenamingChatId(null);
              ctx.setMenuOpenChatId(null);
            }
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => ctx.onNavigateToTask?.(chat.id)}
          className={cn(
            "flex-1 min-w-0 flex items-center gap-2 px-3 py-[6px] text-sm font-normal text-left rounded-lg",
            isActive ? "text-foreground font-medium" : "text-foreground",
          )}
        >
          <span
            className={cn(
              "truncate flex-1 min-w-0 transition-[padding] group-hover/chat:pr-5",
              ctx.menuOpenChatId === chat.id && "pr-5",
            )}
          >
            {chat.title || "New chat"}
          </span>
        </button>
      )}
      {!isRenaming && (
        <Popover
          open={ctx.menuOpenChatId === chat.id}
          onOpenChange={(open) =>
            ctx.setMenuOpenChatId(open ? chat.id : null)
          }
        >
          <PopoverTrigger asChild>
            <IconButton
              label="chat actions"
              variant="ghost"
              size="sm"
              className={cn(
                "absolute right-1.5 top-1/2 -translate-y-1/2 hover:bg-transparent hover:text-foreground",
                ctx.menuOpenChatId === chat.id
                  ? "opacity-100 text-foreground"
                  : "opacity-0 group-hover/chat:opacity-100 text-muted-foreground",
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent
            side="right"
            align="start"
            sideOffset={4}
            className="w-[160px] p-1 shadow-md border border-border bg-surface-overlay rounded-lg"
          >
            <MenuItem
              icon={Pencil}
              onClick={() => ctx.setRenamingChatId(chat.id)}
            >
              Rename
            </MenuItem>
            <MenuItem
              icon={Archive}
              onClick={() => {
                ctx.setMenuOpenChatId(null);
                ctx.onUpdateChat?.(chat.id, { archive: true });
              }}
            >
              Archive
            </MenuItem>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export interface SidebarProps {
  storeId: string;
  activeItem: "chat" | "dashboard" | "influencers";
  onNewChat: () => void;
  onOpenSearch?: () => void;
  onNavigateToTask?: (taskId: string) => void;
  onNavigateToDashboard?: () => void;
  onNavigateToInfluencers?: () => void;
  onUpdateChat?: (
    chatId: string,
    data: { title?: string; archive?: boolean; unarchive?: boolean },
  ) => void;
  activeTaskId?: string | null;
  userName?: string;
  userEmail?: string;
}

function SidebarBody({
  storeId,
  activeItem,
  onNewChat,
  onOpenSearch,
  onNavigateToTask,
  onNavigateToDashboard,
  onNavigateToInfluencers,
  onUpdateChat,
  activeTaskId,
  userName,
  userEmail,
}: SidebarProps) {
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [menuOpenChatId, setMenuOpenChatId] = useState<string | null>(null);
  const [pref, setPref] = useState<SidebarPref>("auto");

  const isNarrow = useSyncExternalStore(
    subscribeNarrow,
    getNarrowSnapshot,
    getNarrowServerSnapshot,
  );

  const collapsed =
    pref === "collapsed" || (pref === "auto" && isNarrow);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_PREF_KEY);
      if (saved === "auto" || saved === "collapsed" || saved === "expanded") {
        setPref(saved);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_PREF_KEY, pref);
    } catch {
      /* ignore */
    }
  }, [pref]);

  const toggleCollapsed = useCallback(() => {
    setPref(collapsed ? "expanded" : "collapsed");
  }, [collapsed]);

  const { chats: recentChats } = useChats(storeId);

  const displayName = userName ?? "User";

  return (
    <TooltipProvider delayDuration={300}>
      <DsSidebar collapsed={collapsed}>
        <SidebarHeader>
          <Text
            size="xl"
            weight="bold"
            tracking="tight"
            className={cn(
              "select-none whitespace-nowrap overflow-hidden flex-1 pl-2 transition-opacity duration-200 ease-in-out",
              collapsed ? "opacity-0" : "opacity-100",
            )}
          >
            pebble
          </Text>
          <Tooltip>
            <TooltipTrigger asChild>
              <IconButton
                label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                variant="ghost"
                size="sm"
                onClick={toggleCollapsed}
                className={cn(
                  "flex-shrink-0 transition-[color,background-color,translate] duration-200 ease-in-out",
                  collapsed && "-translate-x-1",
                )}
              >
                {collapsed ? (
                  <PanelLeftOpen className="h-[18px] w-[18px]" />
                ) : (
                  <PanelLeftClose className="h-[18px] w-[18px]" />
                )}
              </IconButton>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              <Text as="p" size="sm">
                {collapsed ? "Expand sidebar" : "Collapse sidebar"}
              </Text>
            </TooltipContent>
          </Tooltip>
        </SidebarHeader>

        <DsSidebarBody>
          <div className="px-2 space-y-0.5">
            <SidebarItem
              icon={SquarePen}
              onClick={onNewChat}
              shortcut={
                <Kbd variant="ghost" size="inherit" suppressHydrationWarning>
                  {isMac ? "⇧⌘O" : "Ctrl+Shift+O"}
                </Kbd>
              }
            >
              New chat
            </SidebarItem>

            <SidebarItem
              icon={LayoutDashboard}
              active={activeItem === "dashboard"}
              onClick={() => onNavigateToDashboard?.()}
            >
              Dashboard
            </SidebarItem>

            <SidebarItem
              icon={Users}
              active={activeItem === "influencers"}
              onClick={() => onNavigateToInfluencers?.()}
            >
              Influencers
            </SidebarItem>

            <SidebarItem
              icon={Search}
              onClick={() => onOpenSearch?.()}
              shortcut={
                <Kbd variant="ghost" size="inherit" suppressHydrationWarning>
                  {isMac ? "⌘K" : "Ctrl+K"}
                </Kbd>
              }
            >
              Search
            </SidebarItem>
          </div>

          <div className="flex-1 min-h-0 flex flex-col overflow-y-auto overflow-x-hidden pt-2">
            <div
              className={cn(
                "grid transition-[grid-template-rows] duration-200 ease-in-out",
                collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
              )}
            >
              <div className="overflow-hidden">
                <div
                  className={cn(
                    "mt-5 flex flex-col px-2 transition-opacity duration-200 ease-in-out",
                    collapsed
                      ? "opacity-0 pointer-events-none"
                      : "opacity-100",
                  )}
                >
                  <Text
                    size="sm"
                    weight="regular"
                    tone="subtle"
                    className="px-3 pb-1.5"
                  >
                    Chats
                  </Text>
                  {recentChats.length > 0 ? (
                    <div className="space-y-0.5">
                      {recentChats.map((chat) => (
                        <ChatRow
                          key={chat.id}
                          chat={chat}
                          ctx={{
                            activeTaskId,
                            menuOpenChatId,
                            renamingChatId,
                            onNavigateToTask,
                            onUpdateChat,
                            setRenamingChatId,
                            setMenuOpenChatId,
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="px-3 py-2">
                      <Text size="sm" tone="subtle" as="span">
                        No chats yet
                      </Text>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </DsSidebarBody>

        <div className="relative flex-shrink-0">
          <SidebarFooter className="relative z-10 bg-surface-sunken space-y-0.5">
            <AccountPopover
              displayName={displayName}
              userEmail={userEmail}
            />
          </SidebarFooter>
        </div>
      </DsSidebar>
    </TooltipProvider>
  );
}

export function Sidebar(props: SidebarProps) {
  return (
    <div className="hidden sm:flex h-full">
      <SidebarBody {...props} />
    </div>
  );
}

function AccountPopover({
  displayName,
  userEmail,
}: {
  displayName: string;
  userEmail?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <SidebarItem
          icon={User}
          className="truncate data-[state=open]:bg-accent"
        >
          {displayName}
        </SidebarItem>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="right"
        className="w-56 p-0 rounded-xl overflow-visible"
      >
        <div className="py-2.5 px-3 border-b border-border">
          <Text size="sm" weight="medium" truncate>
            {displayName}
          </Text>
          {userEmail && (
            <Text as="p" size="xs" tone="muted" truncate>
              {userEmail}
            </Text>
          )}
        </div>
        <div className="py-1 border-b border-border">
          <MenuItem icon={Settings} onClick={() => setOpen(false)}>
            Settings
          </MenuItem>
          <MenuItem icon={Archive} onClick={() => setOpen(false)}>
            Archived chats
          </MenuItem>
          <div className="relative">
            <MenuItem
              icon={Store}
              shortcut={
                <ChevronRight className="h-4 w-4 text-text-disabled" />
              }
            >
              Switch store
            </MenuItem>
          </div>
        </div>
        <div className="py-1">
          <MenuItem variant="destructive" icon={LogOut}>
            Sign out
          </MenuItem>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* Re-exported for callers that want imperative chat creation. */
export { chatStore };
