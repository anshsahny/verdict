// AG Studio theme for Verdict. Every value points at a design token in app/globals.css, so Studio
// (canvas, widgets, grids, charts) renders as part of the page and follows light/dark with it.

import { studioTheme, type AgStudioLocaleText } from 'ag-studio';

const token = (name: string) => `var(--v-${name})`;
const line = (color: string) => ({ width: 1, color: token(color) });

const palette = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [
    [`chartPaletteFills${i + 1}Color`, token(`chart-${i + 1}`)],
    [`chartPaletteStrokes${i + 1}Color`, token(`chart-${i + 1}`)],
  ]).flat(),
);

export const verdictStudioTheme = studioTheme.withParams({
  fontFamily: token('font'),
  fontSize: 14,
  textColor: token('ink'),
  foregroundColor: token('ink'),
  subtleTextColor: token('muted'),
  backgroundColor: token('surface'),
  borderColor: token('border'),
  accentColor: token('accent'),
  iconColor: token('muted'),
  rowHoverColor: token('highlight'),

  // The default 600px minimum widens the whole page on phones; let the canvas scroll inside the studio instead.
  studioMinWidth: 0,
  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: token('canvas'),
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: token('canvas'),
  studioCanvasPadding: 16,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: token('font'),

  studioWidgetBackgroundColor: token('surface'),
  studioWidgetBorder: line('border'),
  studioWidgetBorderRadius: 10,
  studioWidgetPadding: 12,
  studioWidgetTitleFontFamily: token('font'),
  studioWidgetTitleFontSize: 14,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: token('ink'),
  studioWidgetSubtitleFontFamily: token('font'),
  studioWidgetSubtitleFontSize: 12,
  studioWidgetSubtitleTextColor: token('muted'),
  studioWidgetCaptionFontFamily: token('font'),
  studioWidgetCaptionFontSize: 12,
  studioWidgetCaptionTextColor: token('muted'),
  studioWidgetResizeBorderColor: token('accent'),

  studioPanelContainerBackgroundColor: token('surface'),
  studioPanelContainerBorder: line('border'),
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: token('border'),
  studioPanelDividerActiveColor: token('accent'),
  studioPanelSectionBorderColor: token('border'),
  studioPanelHeaderFontFamily: token('font'),
  studioPanelHeaderFontWeight: 600,
  studioPanelChevronButtonHoverBackgroundColor: token('highlight'),
  studioPanelChevronButtonHoverColor: token('accent'),
  studioToggleButtonActiveBackgroundColor: token('highlight'),
  studioToggleButtonActiveBorderColor: token('accent'),
  studioToggleButtonActiveColor: token('accent'),

  gridFontFamily: token('font'),
  gridFontSize: 13,
  gridCellTextColor: token('ink'),
  gridHeaderBackgroundColor: token('surface'),
  gridHeaderTextColor: token('muted'),
  gridHeaderFontWeight: 600,
  gridHeaderFontSize: 12,
  gridRowHeight: 40,
  gridRowBorder: line('gridline'),
  gridHeaderRowBorder: line('border'),
  gridPinnedRowBorder: line('border'),
  gridRowHoverColor: token('highlight'),
  gridWrapperBorder: false,

  chartFontFamily: token('font'),
  chartTextColor: token('ink'),
  chartSubtleTextColor: token('muted'),
  chartAxisLineColor: token('border'),
  chartGridLineColor: token('gridline'),
  ...palette,
});

// Studio labels summed columns "Amount (sum)"; our measures are already totals, so show the plain name.
export const verdictStudioLocale: AgStudioLocaleText = { aggregationSumFieldName: '${name}' };
