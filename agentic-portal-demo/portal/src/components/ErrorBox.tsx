export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="error-box" role="alert">
      {message}
    </div>
  )
}
