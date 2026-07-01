const isRealUrl = (url) => url && !url.includes('REPLACE');

export default function SplinePlaceholder({
  splineUrl = null,
  title = '',
  subtitle = '',
  height = '500px',
}) {
  if (isRealUrl(splineUrl)) {
    return (
      <div style={{ height }} className="w-full overflow-hidden">
        <iframe
          src={splineUrl}
          frameBorder="0"
          className="w-full h-full"
          allow="autoplay"
          title={title}
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div
      className="w-full relative overflow-hidden blueprint-grid"
      style={{ height, backgroundColor: '#0e1520' }}
    >
      {/* Centered placeholder content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8">
        {/* Gold rule */}
        <span
          style={{
            display: 'block',
            width: '40px',
            height: '1px',
            backgroundColor: '#c4993a',
          }}
        />

        {title && (
          <p
            style={{
              fontFamily: "'Cinzel', serif",
              letterSpacing: '0.2em',
              color: '#ffffff',
              fontSize: '1.125rem',
              fontWeight: 400,
              textAlign: 'center',
            }}
          >
            {title}
          </p>
        )}

        {subtitle && (
          <p
            style={{
              color: '#64748b',
              fontSize: '0.875rem',
              textAlign: 'center',
              letterSpacing: '0.05em',
            }}
          >
            {subtitle}
          </p>
        )}

        {/* Coming soon notice */}
        <div
          style={{
            border: '1px dashed rgba(255,255,255,0.08)',
            padding: '0.5rem 1.25rem',
            marginTop: '0.5rem',
          }}
        >
          <p
            style={{
              color: '#374151',
              fontSize: '0.65rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}
          >
            Interactive 3D coming soon
          </p>
        </div>
      </div>
    </div>
  );
}
