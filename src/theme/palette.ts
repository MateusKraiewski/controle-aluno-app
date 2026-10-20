export type Palette = {
  background: string; surface: string; ink: string; muted: string; green: string; lime: string;
  line: string; orange: string; danger: string; placeholder: string; onGreen: string;
  /** Text accent with enough contrast on the background/surface of each theme. */
  accent: string;
};

export const lightPalette: Palette = { background: '#f5f4ef', surface: '#fff', ink: '#20322d', muted: '#5f6f68', green: '#284d40', lime: '#d8ec86', line: '#e4e8df', orange: '#f3b68d', danger: '#a34839', placeholder: '#7d8a83', onGreen: '#fff', accent: '#284d40' };
export const darkPalette: Palette = { background: '#111a17', surface: '#1d2924', ink: '#edf2ed', muted: '#a2b1a9', green: '#284d40', lime: '#d8ec86', line: '#34443c', orange: '#f3b68d', danger: '#ff9a86', placeholder: '#8a988f', onGreen: '#fff', accent: '#d8ec86' };
