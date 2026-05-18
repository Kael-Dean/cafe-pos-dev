const KEY = 'cafe_pos_token';

export const getToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(KEY);
};

export const setToken = (token: string): void => {
  localStorage.setItem(KEY, token);
};

export const clearToken = (): void => {
  localStorage.removeItem(KEY);
};
