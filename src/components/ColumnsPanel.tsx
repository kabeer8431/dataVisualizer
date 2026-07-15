import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import SortableColumnItem from './SortableColumnItem'

type ColumnsPanelProps = {
  columns: string[]
  selectedColumns: string[]
  onToggleColumn: (column: string) => void
  onDragEnd: (event: DragEndEvent) => void
  sensors: any
}

function ColumnsPanel({
  columns,
  selectedColumns,
  onToggleColumn,
  onDragEnd,
  sensors,
}: ColumnsPanelProps) {
  return (
    <>
      <article className="card">
        <h2>All Columns ({columns.length})</h2>
        <p className="subtle">Click to include/exclude columns from arrangement.</p>
        <div className="column-list">
          {columns.map((column) => (
            <button
              key={column}
              type="button"
              onClick={() => onToggleColumn(column)}
              className={`pill ${selectedColumns.includes(column) ? 'active' : ''}`}
            >
              {column}
            </button>
          ))}
        </div>
      </article>

      <article className="card">
        <h2>Arrange Columns</h2>
        <p className="subtle">Drag to set your preferred column order.</p>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={selectedColumns} strategy={verticalListSortingStrategy}>
            <ul className="sortable-list">
              {selectedColumns.map((column) => (
                <SortableColumnItem key={column} column={column} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </article>
    </>
  )
}

export default ColumnsPanel
