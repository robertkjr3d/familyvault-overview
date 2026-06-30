import { useState } from “react”;
import { Link } from “@tanstack/react-router”;
import {
Home, Building2, Shield, Landmark, MoreHorizontal,
TrendingUp, PiggyBank, Heart, Package, Settings as SettingsIcon, Gem,
type LucideIcon,
} from “lucide-react”;

import {
Drawer,
DrawerContent,
DrawerHeader,
DrawerTitle,
} from “@/components/ui/drawer”;
import { useIsMobile } from “@/hooks/use-mobile”;

type Tab = { to: string; label: string; icon: LucideIcon };

const MOBILE_PRIMARY: Tab[] = [
{ to: “/”,          label: “Home”,      icon: Home },
{ to: “/property”,  label: “Property”,  icon: Building2 },
{ to: “/insurance”, label: “Insurance”, icon: Shield },
{ to: “/loans”,     label: “Loans”,     icon: Landmark },
];

const MOBILE_MORE: Tab[] = [
{ to: “/investments”,    label: “Investments”,  icon: TrendingUp },
{ to: “/savings”,        label: “Savings”,      icon: PiggyBank },
{ to: “/health”,         label: “Health”,       icon: Heart },
{ to: “/inventory”,      label: “Inventory”,    icon: Package },
{ to: “/other-assets”,   label: “Assets”,       icon: Gem },
{ to: “/settings”,       label: “Settings”,     icon: SettingsIcon },
];

const ALL_TABS: Tab[] = […MOBILE_PRIMARY, …MOBILE_MORE];

export function BottomTabs() {
const isMobile = useIsMobile();
const [moreOpen, setMoreOpen] = useState(false);

if (isMobile) {
return (
<>
<nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
<ul className="grid grid-cols-5">
{MOBILE_PRIMARY.map((t) => <TabItem key={t.to} t={t} />)}
<li>
<button
type=“button”
onClick={() => setMoreOpen(true)}
className=“flex w-full flex-col items-center gap-0.5 py-2.5 text-[10px] text-muted-foreground”
aria-label=“More”
>
<MoreHorizontal className="h-5 w-5" />
<span className="font-medium">More</span>
</button>
</li>
</ul>
</nav>
<Drawer open={moreOpen} onOpenChange={setMoreOpen}>
<DrawerContent>
<DrawerHeader>
<DrawerTitle className="text-base">More</DrawerTitle>
</DrawerHeader>
<ul className="divide-y divide-border px-4 pb-8">
{MOBILE_MORE.map((t) => {
const Icon = t.icon;
return (
<li key={t.to}>
<Link
to={t.to}
onClick={() => setMoreOpen(false)}
className=“flex items-center gap-3 px-1 py-3.5 text-sm font-medium transition hover:bg-accent/40 rounded-md”
>
<Icon className="h-5 w-5 text-muted-foreground" />
<span>{t.label}</span>
</Link>
</li>
);
})}
</ul>
</DrawerContent>
</Drawer>
</>
);
}

return (
<nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur">
<ul className="mx-auto grid max-w-3xl grid-cols-10">
{ALL_TABS.map((t) => <TabItem key={t.to} t={t} />)}
</ul>
</nav>
);
}

function TabItem({ t }: { t: Tab }) {
const Icon = t.icon;
return (
<li>
<Link
to={t.to}
activeOptions={{ exact: t.to === “/” }}
className=“group relative flex flex-col items-center py-2 text-[10px] text-muted-foreground transition-colors data-[status=active]:text-primary”
>
<span className="flex flex-col items-center gap-0.5 rounded-xl px-3 py-1 transition-colors group-data-[status=active]:bg-primary/10">
<Icon className="h-5 w-5" />
<span className="font-medium">{t.label}</span>
</span>
</Link>
</li>
);
}
