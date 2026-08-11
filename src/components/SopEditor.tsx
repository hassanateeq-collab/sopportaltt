import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle, Color, FontFamily } from '@tiptap/extension-text-style'
import { TableKit } from '@tiptap/extension-table'

/**
 * A Word-like rich text editor for writing an SOP body: headings, fonts, bold /
 * italic / underline / strike, colour, alignment, bulleted and numbered lists,
 * and tables. The parent gets the live editor instance via `onEditor` and reads
 * `editor.getHTML()` at save time (which is then rendered to a real .docx).
 */

const FONTS = ['Arial', 'Calibri', 'Times New Roman', 'Georgia', 'Verdana', 'Tahoma', 'Courier New']

export function SopEditor({ onEditor }: { onEditor: (e: Editor | null) => void }) {
  const editor = useEditor({
    extensions: [
      StarterKit, // includes bold, italic, underline, strike, lists, headings, undo/redo
      TextStyle,
      Color,
      FontFamily,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TableKit.configure({ table: { resizable: true } }),
    ],
    content: '<p></p>',
  })

  useEffect(() => {
    onEditor(editor)
    return () => onEditor(null)
  }, [editor, onEditor])

  if (!editor) {
    return <div className="sopeditor"><div className="sopeditor-area"><span className="spinner" /> Loading editor…</div></div>
  }

  return (
    <div className="sopeditor">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} className="sopeditor-area" />
    </div>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const btn = (active: boolean, on: () => void, label: ReactNode, title: string) => (
    <button
      type="button"
      className={`se-btn ${active ? 'on' : ''}`}
      title={title}
      onMouseDown={(e) => { e.preventDefault(); on() }}
    >
      {label}
    </button>
  )

  const headingValue = editor.isActive('heading', { level: 1 })
    ? 'h1'
    : editor.isActive('heading', { level: 2 })
      ? 'h2'
      : editor.isActive('heading', { level: 3 })
        ? 'h3'
        : 'p'

  return (
    <div className="se-toolbar">
      <select
        className="se-sel"
        title="Font"
        value=""
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const v = e.target.value
          if (v) editor.chain().focus().setFontFamily(v).run()
          else editor.chain().focus().unsetFontFamily().run()
        }}
      >
        <option value="">Font</option>
        {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
      </select>

      <select
        className="se-sel"
        title="Paragraph style"
        value={headingValue}
        onChange={(e) => {
          const v = e.target.value
          if (v === 'p') editor.chain().focus().setParagraph().run()
          else editor.chain().focus().toggleHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run()
        }}
      >
        <option value="p">Normal</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>

      {btn(editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), <b>B</b>, 'Bold')}
      {btn(editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), <i>I</i>, 'Italic')}
      {btn(editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run(), <u>U</u>, 'Underline')}
      {btn(editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run(), <s>S</s>, 'Strikethrough')}

      <label className="se-color" title="Text colour" onMouseDown={(e) => e.preventDefault()}>
        <span>A</span>
        <input type="color" onChange={(e) => editor.chain().focus().setColor(e.target.value).run()} />
      </label>

      <span className="se-div" />
      {btn(editor.isActive({ textAlign: 'left' }), () => editor.chain().focus().setTextAlign('left').run(), '⟸', 'Align left')}
      {btn(editor.isActive({ textAlign: 'center' }), () => editor.chain().focus().setTextAlign('center').run(), '≡', 'Centre')}
      {btn(editor.isActive({ textAlign: 'right' }), () => editor.chain().focus().setTextAlign('right').run(), '⟹', 'Align right')}

      <span className="se-div" />
      {btn(editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), '• List', 'Bulleted list')}
      {btn(editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), '1. List', 'Numbered list')}

      <span className="se-div" />
      {btn(false, () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), '▦ Table', 'Insert 3×3 table')}
      {btn(false, () => editor.chain().focus().addRowAfter().run(), '＋Row', 'Add row below')}
      {btn(false, () => editor.chain().focus().addColumnAfter().run(), '＋Col', 'Add column')}
      {btn(false, () => editor.chain().focus().deleteRow().run(), '－Row', 'Delete row')}
      {btn(false, () => editor.chain().focus().deleteColumn().run(), '－Col', 'Delete column')}
      {btn(false, () => editor.chain().focus().deleteTable().run(), '✕ Table', 'Delete table')}

      <span className="se-div" />
      {btn(false, () => editor.chain().focus().undo().run(), '↶', 'Undo')}
      {btn(false, () => editor.chain().focus().redo().run(), '↷', 'Redo')}
    </div>
  )
}
