import { CSV_TEMPLATE } from '@/lib/questions-csv'

export function GET() {
  return new Response(CSV_TEMPLATE, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="twister-question-template.csv"',
    },
  })
}
