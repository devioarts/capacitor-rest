import type { ReactNode } from "react";
import { PageHome } from "./pages/PageHome.tsx";
import { PageTests } from "./pages/PageTests.tsx";

export type TabItem = {
	id: string;
	label: string;
	page: ReactNode;
};

export const tabs: TabItem[] = [
  { id: "server", label: "Server", page: <PageHome /> },
  { id: "tests", label: "Tests", page: <PageTests /> },
];
