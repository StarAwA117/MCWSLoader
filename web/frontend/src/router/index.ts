import { createRouter, createWebHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";

declare module "vue-router" {
	interface RouteMeta {
		title?: string;
		titleKey?: string;
		icon?: string;
		public?: boolean;
	}
}

const routes: RouteRecordRaw[] = [
	{ path: "/login", name: "login", component: () => import("../views/Login.vue"), meta: { title: "Login", titleKey: "nav.login", public: true } },
	{ path: "/", name: "dashboard", component: () => import("../views/Dashboard.vue"), meta: { title: "Dashboard", titleKey: "nav.dashboard", icon: "dashboard" } },
	{ path: "/mods", name: "mods", component: () => import("../views/Mods.vue"), meta: { title: "Mods", titleKey: "nav.mods", icon: "mods" } },
	{ path: "/commands", name: "commands", component: () => import("../views/Commands.vue"), meta: { title: "Commands", titleKey: "nav.commands", icon: "commands" } },
	{ path: "/permissions", name: "permissions", component: () => import("../views/Permissions.vue"), meta: { title: "Permissions", titleKey: "nav.permissions", icon: "permissions" } },
	{ path: "/clients", name: "clients", component: () => import("../views/Clients.vue"), meta: { title: "Clients", titleKey: "nav.clients", icon: "clients" } },
	{ path: "/logs", name: "logs", component: () => import("../views/Logs.vue"), meta: { title: "Logs", titleKey: "nav.logs", icon: "logs" } },
	{ path: "/chat", name: "chat", component: () => import("../views/Chat.vue"), meta: { title: "Chat", titleKey: "nav.chat", icon: "chat" } },
	{ path: "/update", redirect: "/settings?tab=system" },
	{ path: "/settings", name: "settings", component: () => import("../views/Settings.vue"), meta: { title: "Settings", titleKey: "nav.settings", icon: "config" } },
	{ path: "/:pathMatch(.*)*", redirect: "/" }
];

const router = createRouter({
	history: createWebHistory(),
	routes
});

router.beforeEach((to, _from, next) => {
	const token = sessionStorage.getItem("auth_token");
	if (!to.meta.public && !token) {
		next("/login");
	} else if (to.path === "/login" && token) {
		next("/");
	} else {
		next();
	}
});

export default router;
export { routes };
