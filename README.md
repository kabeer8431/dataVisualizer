# dataVisualizer

Web UI project to upload an Excel file, list all detected columns, arrange columns in order, choose a chart type, and render an interactive chart.

## Features

- Upload `.xlsx`, `.xls`, `.csv`, or `.json` files
- Detect and list all columns from the first sheet
- Select/unselect columns and drag to rearrange order
- Choose chart type: Bar, Line, Area, Scatter, Pie, Sunburst
- Configure X-axis/category and Y-axis/value columns
- Render responsive, interactive charts (tooltip, legend, zoom-friendly layout)
- Handles larger files by loading up to 25,000 rows for smooth browser performance

## Tech Stack

- React + TypeScript + Vite
- SheetJS (`xlsx`) for Excel parsing
- Recharts for interactive charting
- `@dnd-kit` for drag-and-drop column arrangement

## Run Locally

```bash
npm install
npm run dev
```

Open the local URL shown by Vite (usually `http://localhost:5173`).

## Build

```bash
npm run build
npm run preview
```

## Workflow

1. Upload an Excel file.
2. Review all extracted columns.
3. Toggle columns and drag to arrange order.
4. Select chart type and axis/value mapping.
5. Click **Render Interactive Chart** to generate chart output below the controls.

## Notes

- The app reads only the first sheet in the workbook.
- For very large files, the app limits rendering to first 25,000 rows to keep interaction smooth.
