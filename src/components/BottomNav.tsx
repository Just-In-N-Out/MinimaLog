import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Home as HomeIcon, History, LineChart, Trophy, User } from "lucide-react";

export const BottomNav = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { path: "/history", icon: History, label: "History" },
    { path: "/progress", icon: LineChart, label: "Progress" },
    { path: "/", icon: HomeIcon, label: "Home" },
    { path: "/prs", icon: Trophy, label: "PRs" },
    { path: "/profile", icon: User, label: "Profile" },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-background border-t z-50">
      <div className="container mx-auto px-4 py-3 flex justify-around">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          
          return (
            <Button 
              key={item.path}
              variant="ghost" 
              onClick={() => navigate(item.path)}
              className="flex flex-col items-center gap-1.5 text-xs hover:bg-transparent"
            >
              <div className={`p-2 rounded-full transition-colors ${isActive ? 'bg-foreground' : 'bg-transparent'}`}>
                <Icon className={`h-5 w-5 ${isActive ? 'text-background' : 'text-muted-foreground'}`} />
              </div>
              <span className={isActive ? 'text-foreground font-semibold' : 'text-muted-foreground'}>
                {item.label}
              </span>
            </Button>
          );
        })}
      </div>
    </nav>
  );
};


