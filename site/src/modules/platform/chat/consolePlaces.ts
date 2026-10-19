/** Where admins' chat console lives: a card at the top of Controls › Settings › Chat. */
export const CHAT_CONSOLE_PAGE = "/deployment/chat";
/** The console popped out of that card into a window of its own (full size, no dashboard around it). */
export const CHAT_CONSOLE_WINDOW = "/chat-console";
/** The popped-out window's name: one at a time, reused. */
export const CHAT_CONSOLE_WINDOW_NAME = "coder-chat-console";
/** How the card and its popped-out window talk (BroadcastChannel): "out" (it opened), "in" (pop back in). */
export const CHAT_CONSOLE_CHANNEL = "coder-chat-console";
