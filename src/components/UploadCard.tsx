import type * as XLSX from 'xlsx'

type SheetDataState = {
  workbook: XLSX.WorkBook | null
  sheetNames: string[]
  selectedSheet: string
}

type UploadCardProps = {
  fileName: string
  sheetData: SheetDataState
  notice: string
  error: string
  onUpload: (event: React.ChangeEvent<HTMLInputElement>) => void
  onSheetChange: (event: React.ChangeEvent<HTMLSelectElement>) => void
}

function UploadCard({
  fileName,
  sheetData,
  notice,
  error,
  onUpload,
  onSheetChange,
}: UploadCardProps) {
  return (
    <section className="card">
      <label htmlFor="excel-file" className="upload-label">
        Upload data file (.xlsx, .xls, .csv, .json)
      </label>
      <input
        id="excel-file"
        type="file"
        accept=".xlsx,.xls,.csv,.json"
        onChange={onUpload}
        className="file-input"
      />

      {fileName && <p className="meta">Loaded file: {fileName}</p>}
      {sheetData.sheetNames.length > 0 && (
        <label className="sheet-select-label">
          Select sheet
          <select value={sheetData.selectedSheet} onChange={onSheetChange}>
            {sheetData.sheetNames.map((sheetName) => (
              <option key={sheetName} value={sheetName}>
                {sheetName}
              </option>
            ))}
          </select>
        </label>
      )}
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

export default UploadCard
