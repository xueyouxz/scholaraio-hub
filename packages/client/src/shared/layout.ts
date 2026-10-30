import { createContext, useContext } from "react";
import { useOutletContext } from "react-router-dom";

/**
 * What the app's navigation layout offers the pages it frames. The layout
 * (`app/components/NavigationLayout.tsx`) provides both; pages and features
 * only read them, so they depend on this contract and not on the app shell.
 */

interface PageTitleContextValue {
  setTitle: (title: string) => void;
}

export const PageTitleContext = createContext<PageTitleContextValue>({
  setTitle: () => {},
});

/** Set the title the layout shows above a page. */
export function usePageTitle() {
  return useContext(PageTitleContext);
}

export interface NavigationLayoutContext {
  isDesktop: boolean;
}

/** The layout's state that a page adapts to, passed through the router outlet. */
export function useNavigationLayout() {
  return useOutletContext<NavigationLayoutContext>();
}
