/**
 * Markora Minimalist Vector Icon System (16x16 Pixel-Aligned SVGs)
 * Replaces system emojis with crisp, theme-adaptive stroke + subtle duotone SVGs.
 */

(function (global) {
  'use strict';

  const Icons = {
    // Markdown Document Icon: folded-corner sheet with a crisp mini 'M' mark inside
    mdFile: `<svg class="mk-svg-icon mk-icon-md" width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3.5 1.75H9.8L13.25 5.2V13.25C13.25 13.8 12.8 14.25 12.25 14.25H3.75C3.2 14.25 2.75 13.8 2.75 13.25V2.5C2.75 2.08 3.08 1.75 3.5 1.75Z" fill="currentColor" fill-opacity="0.07" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>
      <path d="M9.5 1.85V5.25H13.15" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.75"/>
      <path d="M5.35 11.1V7.5L7.4 9.85L9.45 7.5V11.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="10.65" y1="11.1" x2="11.45" y2="11.1" stroke="var(--accent-color)" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`,

    // Generic Text Document Icon (.txt): folded-corner sheet with clean text lines
    txtFile: `<svg class="mk-svg-icon mk-icon-txt" width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3.5 1.75H9.8L13.25 5.2V13.25C13.25 13.8 12.8 14.25 12.25 14.25H3.75C3.2 14.25 2.75 13.8 2.75 13.25V2.5C2.75 2.08 3.08 1.75 3.5 1.75Z" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>
      <path d="M9.5 1.85V5.25H13.15" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.75"/>
      <line x1="5.25" y1="8.25" x2="10.75" y2="8.25" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      <line x1="5.25" y1="10.75" x2="8.75" y2="10.75" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
    </svg>`,

    // Folder Closed
    folderClosed: `<svg class="mk-svg-icon mk-icon-folder" width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1.75 4.25C1.75 3.56 2.31 3 3 3H6.15C6.52 3 6.87 3.16 7.11 3.44L8.1 4.6H13C13.69 4.6 14.25 5.16 14.25 5.85V11.75C14.25 12.44 13.69 13 13 13H3C2.31 13 1.75 12.44 1.75 11.75V4.25Z" fill="currentColor" fill-opacity="0.09" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>
    </svg>`,

    // Folder Open
    folderOpen: `<svg class="mk-svg-icon mk-icon-folder-open" width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1.75 4.25C1.75 3.56 2.31 3 3 3H5.95C6.32 3 6.67 3.16 6.91 3.44L7.85 4.5H12.75C13.44 4.5 14 5.06 14 5.75V6.75H3.35L1.75 11.5V4.25Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>
      <path d="M1.85 11.8L3.25 7.25H14.45L13.1 12.05C12.95 12.6 12.45 13 11.88 13H2.95C2.22 13 1.68 12.42 1.85 11.8Z" fill="currentColor" fill-opacity="0.11" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>
    </svg>`,

    // Chevron Down (rotates -90deg when collapsed)
    chevron: `<svg class="mk-svg-icon mk-icon-chevron" width="11" height="11" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,

    // Checkmark
    check: `<svg class="mk-svg-icon mk-icon-check" width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="var(--accent-color)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,

    // Callout Icons
    calloutNote: `<svg class="mk-svg-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.25" stroke="currentColor" stroke-width="1.35"/><line x1="8" y1="7.2" x2="8" y2="11.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="4.9" r="0.85" fill="currentColor"/></svg>`,
    calloutTip: `<svg class="mk-svg-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 12.5H10M6.5 14.2H9.5M8 2C5.5 2 3.75 3.85 3.75 6.1C3.75 7.65 4.6 8.95 5.75 9.75C6.1 10 6.3 10.4 6.35 10.85H9.65C9.7 10.4 9.9 10 10.25 9.75C11.4 8.95 12.25 7.65 12.25 6.1C12.25 3.85 10.5 2 8 2Z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    calloutImportant: `<svg class="mk-svg-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 2.75H13V10.75H6.2L3 13.25V2.75Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><line x1="8" y1="5.2" x2="8" y2="7.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="9.3" r="0.75" fill="currentColor"/></svg>`,
    calloutWarning: `<svg class="mk-svg-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2.25L14.25 13.25H1.75L8 2.25Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><line x1="8" y1="6.5" x2="8" y2="9.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="11.4" r="0.75" fill="currentColor"/></svg>`,
    calloutCaution: `<svg class="mk-svg-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><polygon points="5.4,2 10.6,2 14,5.4 14,10.6 10.6,14 5.4,14 2,10.6 2,5.4" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><line x1="8" y1="5.2" x2="8" y2="8.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="10.9" r="0.8" fill="currentColor"/></svg>`,

    // Context Menu, Search & Image Controls
    search: `<svg class="mk-svg-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="7.2" cy="7.2" r="4.6" stroke="currentColor" stroke-width="1.35"/><path d="M10.7 10.7L13.75 13.75" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/></svg>`,
    filePlus: `<svg class="mk-svg-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 1.75H9.8L13.25 5.2V13.25C13.25 13.8 12.8 14.25 12.25 14.25H3.75C3.2 14.25 2.75 13.8 2.75 13.25V2.5C2.75 2.08 3.08 1.75 3.5 1.75Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M8 7V11.5M5.75 9.25H10.25" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
    folderPlus: `<svg class="mk-svg-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1.75 4.25C1.75 3.56 2.31 3 3 3H6.15C6.52 3 6.87 3.16 7.11 3.44L8.1 4.6H13C13.69 4.6 14.25 5.16 14.25 5.85V11.75C14.25 12.44 13.69 13 13 13H3C2.31 13 1.75 12.44 1.75 11.75V4.25Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M8 6.8V10.8M6 8.8H10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
    rename: `<svg class="mk-svg-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10.9 2.6L13.4 5.1L5.4 13.1H2.9V10.6L10.9 2.6Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M9.4 4.1L11.9 6.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
    copy: `<svg class="mk-svg-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="5.25" y="5.25" width="8.25" height="8.25" rx="1.5" stroke="currentColor" stroke-width="1.25"/><path d="M3.75 10.75H3.25C2.56 10.75 2 10.19 2 9.5V3.25C2 2.56 2.56 2 3.25 2H9.5C10.19 2 10.75 2.56 10.75 3.25V3.75" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>`,
    external: `<svg class="mk-svg-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6.25 3.25H3.5C2.81 3.25 2.25 3.81 2.25 4.5V12.5C2.25 13.19 2.81 13.75 3.5 13.75H11.5C12.19 13.75 12.75 13.19 12.75 12.5V9.75" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/><path d="M9.25 2.25H13.75V6.75M13.5 2.5L7.5 8.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    trash: `<svg class="mk-svg-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2.75 4.25H13.25M6 4.25V2.75C6 2.34 6.34 2 6.75 2H9.25C9.66 2 10 2.34 10 2.75V4.25M4.1 4.25L4.65 12.6C4.7 13.25 5.24 13.75 5.9 13.75H10.1C10.76 13.75 11.3 13.25 11.35 12.6L11.9 4.25" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.75 7V11M9.25 7V11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
    image: `<svg class="mk-svg-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2.75" width="12" height="10.5" rx="1.75" stroke="currentColor" stroke-width="1.25"/><circle cx="5.6" cy="6.1" r="1.15" fill="currentColor"/><path d="M2.5 11.8L6.1 8.4L8.7 10.8L10.8 8.9L13.5 11.8" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    zoomIn: `<svg class="mk-svg-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M9.75 2.25H13.75V6.25M6.25 13.75H2.25V9.75M13.5 2.5L9.25 6.75M2.5 13.5L6.75 9.25" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

    fileForName(filename) {
      const lower = String(filename || '').toLowerCase();
      if (lower.endsWith('.txt')) return this.txtFile;
      return this.mdFile;
    }
  };

  global.MarkoraIcons = Icons;
})(window);
