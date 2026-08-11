import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'

/**
 * A Google Docs–style rich text editor for writing an SOP body: paragraph
 * styles, fonts and font sizes, bold / italic / underline / strike, text colour
 * and highlight, links, images, alignment (incl. justify), bulleted / numbered /
 * checklists, indent & outdent, tables, and clear-formatting. The parent gets
 * the live editor via `onEditor` and reads `editor.getHTML()` at save time.
 */

const FONTS = ['Arial', 'Calibri', 'Times New Roman', 'Georgia', 'Verdana', 'Tahoma', 'Courier New']
const SIZES = ['10', '11', '12', '14', '16', '18', '24', '30', '36']

export function SopEditor({ onEditor }: { onEditor: (e: Editor | null) => void }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }), // bold, italic, underline, strike, lists, headings, link, undo/redo
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      Highlight.configure({ multicolor: true }),
      Image.configure({ inline: false, allowBase64: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
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
  const imgInput = useRef<HTMLInputElement>(null)

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

  function setLink() {
    const prev = (editor.getAttributes('link').href as string) ?? ''
    const url = window.prompt('Link URL (leave blank to remove):', prev)
    if (url === null) return
    if (url === '') editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const r = new FileReader()
    r.onload = () => editor.chain().focus().setImage({ src: String(r.result) }).run()
    r.readAsDataURL(f)
  }

  // Indent / outdent work on the current list (bullet, ordered or checklist).
  const indent = () => { if (!editor.chain().focus().sinkListItem('listItem').run()) editor.chain().focus().sinkListItem('taskItem').run() }
  const outdent = () => { if (!editor.chain().focus().liftListItem('listItem').run()) editor.chain().focus().liftListItem('taskItem').run() }

  return (
    <div className="se-toolbar">
      {btn(false, () => editor.chain().focus().undo().run(), '↶', 'Undo')}
      {btn(false, () => editor.chain().focus().redo().run(), '↷', 'Redo')}
      {btn(false, () => editor.chain().focus().unsetAllMarks().clearNodes().run(), '⌫ᶠ', 'Clear formatting')}
      <span className="se-div" />

      <select
        className="se-sel se-style"
        title="Paragraph style"
        value={headingValue}
        onChange={(e) => {
          const v = e.target.value
          if (v === 'p') editor.chain().focus().setParagraph().run()
          else editor.chain().focus().toggleHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run()
        }}
      >
        <option value="p">Normal text</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>

      <select
        className="se-sel se-font"
        title="Font"
        value=""
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
        className="se-sel se-size"
        title="Font size"
        value=""
        onChange={(e) => { if (e.target.value) editor.chain().focus().setFontSize(`${e.target.value}px`).run() }}
      >
        <option value="">Size</option>
        {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      <span className="se-div" />
      {btn(editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), <b>B</b>, 'Bold')}
      {btn(editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), <i>I</i>, 'Italic')}
      {btn(editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run(), <u>U</u>, 'Underline')}
      {btn(editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run(), <s>S</s>, 'Strikethrough')}

      <label className="se-color" title="Text colour" onMouseDown={(e) => e.preventDefault()}>
        <span>A</span>
        <input type="color" onChange={(e) => editor.chain().focus().setColor(e.target.value).run()} />
      </label>
      <label className="se-color" title="Highlight" onMouseDown={(e) => e.preventDefault()}>
        <span style={{ background: '#fde68a', padding: '0 2px' }}>🖍</span>
        <input type="color" onChange={(e) => editor.chain().focus().toggleHighlight({ color: e.target.value }).run()} />
      </label>

      <span className="se-div" />
      {btn(editor.isActive('link'), setLink, '🔗', 'Link')}
      {btn(false, () => imgInput.current?.click(), '🖼', 'Insert image')}
      <input ref={imgInput} type="file" accept="image/*" style={{ display: 'none' }} onChange={pickImage} />

      <span className="se-div" />
      {btn(editor.isActive({ textAlign: 'left' }), () => editor.chain().focus().setTextAlign('left').run(), '⟸', 'Align left')}
      {btn(editor.isActive({ textAlign: 'center' }), () => editor.chain().focus().setTextAlign('center').run(), '≡', 'Centre')}
      {btn(editor.isActive({ textAlign: 'right' }), () => editor.chain().focus().setTextAlign('right').run(), '⟹', 'Align right')}
      {btn(editor.isActive({ textAlign: 'justify' }), () => editor.chain().focus().setTextAlign('justify').run(), '☰', 'Justify')}

      <span className="se-div" />
      {btn(editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), '• List', 'Bulleted list')}
      {btn(editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), '1. List', 'Numbered list')}
      {btn(editor.isActive('taskList'), () => editor.chain().focus().toggleTaskList().run(), '☑', 'Checklist')}
      {btn(false, outdent, '⇤', 'Decrease indent')}
      {btn(false, indent, '⇥', 'Increase indent')}

      <span className="se-div" />
      {btn(false, () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), '▦ Table', 'Insert 3×3 table')}
      {btn(false, () => editor.chain().focus().addRowAfter().run(), '＋Row', 'Add row below')}
      {btn(false, () => editor.chain().focus().addColumnAfter().run(), '＋Col', 'Add column')}
      {btn(false, () => editor.chain().focus().deleteRow().run(), '－Row', 'Delete row')}
      {btn(false, () => editor.chain().focus().deleteColumn().run(), '－Col', 'Delete column')}
      {btn(false, () => editor.chain().focus().deleteTable().run(), '✕ Table', 'Delete table')}
    </div>
  )
}
