import {
	type AnchorHTMLAttributes,
	type ReactNode,
	useEffect,
	useState,
} from "react";

const NAV_EVENT = "musicbot:navigate";

export function getPath(): string {
	return window.location.pathname;
}

export function navigate(to: string): void {
	if (to === window.location.pathname) return;
	window.history.pushState({}, "", to);
	window.dispatchEvent(new Event(NAV_EVENT));
}

export function usePath(): string {
	const [path, setPath] = useState<string>(() => getPath());
	useEffect(() => {
		const update = () => setPath(getPath());
		window.addEventListener("popstate", update);
		window.addEventListener(NAV_EVENT, update);
		return () => {
			window.removeEventListener("popstate", update);
			window.removeEventListener(NAV_EVENT, update);
		};
	}, []);
	return path;
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
	to: string;
	children: ReactNode;
};

export function Link({ to, onClick, children, ...rest }: LinkProps) {
	return (
		<a
			href={to}
			onClick={(e) => {
				// Let modifier-clicks / middle-click open in a new tab as expected.
				if (
					e.defaultPrevented ||
					e.button !== 0 ||
					e.metaKey ||
					e.ctrlKey ||
					e.shiftKey ||
					e.altKey
				) {
					return;
				}
				e.preventDefault();
				navigate(to);
				onClick?.(e);
			}}
			{...rest}
		>
			{children}
		</a>
	);
}
