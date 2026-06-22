import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠</div>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Щось пішло не так</h2>
          <p style={{ color: 'var(--text2)', fontSize: 14, marginBottom: 16 }}>
            {this.state.error?.message || 'Невідома помилка'}
          </p>
          <button
            className="btn btn-primary"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Спробувати знову
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
