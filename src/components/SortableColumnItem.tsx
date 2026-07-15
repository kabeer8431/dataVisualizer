import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

type SortableColumnItemProps = {
  column: string
}

function SortableColumnItem({ column }: SortableColumnItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: column })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`sortable-item ${isDragging ? 'dragging' : ''}`}
    >
      <button className="drag-handle" type="button" {...attributes} {...listeners}>
        drag
      </button>
      <span>{column}</span>
    </li>
  )
}

export default SortableColumnItem
