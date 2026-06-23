export function redirectWithCurrentSearch(request: Request, pathname: string): string {
  const search = new URL(request.url).search;
  return `${pathname}${search}`;
}
