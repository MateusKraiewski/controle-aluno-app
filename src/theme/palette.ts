import type { SubjectColor } from '../features/subjects/colors';

export type Palette = {
  background: string; surface: string; ink: string; muted: string; green: string; lime: string;
  line: string; orange: string; danger: string; placeholder: string; onGreen: string;
  /** Text accent with enough contrast on the background/surface of each theme. */
  accent: string;
  /**
   * Subject colours per theme. Every value has at least 4.8:1 contrast against this
   * theme's background and surface (checked with the WCAG formula), and the colour is
   * always shown next to the subject or colour name, never as the only cue.
   */
  subject: Record<SubjectColor, string>;
};

export const lightPalette: Palette = {
  background: '#f5f4ef', surface: '#fff', ink: '#20322d', muted: '#5f6f68', green: '#284d40', lime: '#d8ec86', line: '#e4e8df', orange: '#f3b68d', danger: '#a34839', placeholder: '#7d8a83', onGreen: '#fff', accent: '#284d40',
  subject: { green: '#2e6b4f', blue: '#2f5f9e', purple: '#6b4fa0', red: '#b03a48', orange: '#a35400', teal: '#1d7373', pink: '#a8407f', gray: '#5f6f68' },
};
export const darkPalette: Palette = {
  background: '#111a17', surface: '#1d2924', ink: '#edf2ed', muted: '#a2b1a9', green: '#284d40', lime: '#d8ec86', line: '#34443c', orange: '#f3b68d', danger: '#ff9a86', placeholder: '#8a988f', onGreen: '#fff', accent: '#d8ec86',
  subject: { green: '#7fd1a3', blue: '#8fb8f0', purple: '#c3a6f0', red: '#f29aa3', orange: '#f0b46b', teal: '#6fd1d1', pink: '#f0a0cf', gray: '#b0bcb5' },
};
