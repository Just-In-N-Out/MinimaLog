import { ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, PanInfo, useMotionValue, animate } from "framer-motion";

interface SwipeablePagesProps {
  children: ReactNode;
}

export const SwipeablePages = ({ children }: SwipeablePagesProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const x = useMotionValue(0);

  const navOrder = ["/history", "/progress", "/", "/prs", "/profile"];
  const currentIndex = navOrder.indexOf(location.pathname);

  const handleDrag = (_: any, info: PanInfo) => {
    // Allow dragging to show adjacent pages
    const dragDistance = info.offset.x;
    
    // Prevent dragging beyond first/last page
    if (currentIndex === 0 && dragDistance > 0) {
      x.set(dragDistance * 0.3); // Reduced resistance at boundary
    } else if (currentIndex === navOrder.length - 1 && dragDistance < 0) {
      x.set(dragDistance * 0.3); // Reduced resistance at boundary
    } else {
      x.set(dragDistance);
    }
  };

  const handleDragEnd = (_: any, info: PanInfo) => {
    const threshold = 100;
    const velocity = info.velocity.x;
    const offset = info.offset.x;

    // Swipe right (go to previous page)
    if ((offset > threshold || velocity > 500) && currentIndex > 0) {
      animate(x, 0, { type: "spring", stiffness: 300, damping: 30 }).then(() => {
        navigate(navOrder[currentIndex - 1]);
      });
    }
    // Swipe left (go to next page)
    else if ((offset < -threshold || velocity < -500) && currentIndex < navOrder.length - 1) {
      animate(x, 0, { type: "spring", stiffness: 300, damping: 30 }).then(() => {
        navigate(navOrder[currentIndex + 1]);
      });
    }
    // Snap back
    else {
      animate(x, 0, { type: "spring", stiffness: 300, damping: 30 });
    }
  };

  return (
    <motion.div
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
      style={{ x }}
      className="h-full w-full touch-pan-y"
    >
      {children}
    </motion.div>
  );
};


