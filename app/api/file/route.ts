import { type NextRequest, NextResponse } from 'next/server'
import { withRateLimit } from '@/lib/rate-limit'
import { getMimeTypeFromExtension } from '@/lib/file-validation'

// Validate pathname to prevent path traversal and enforce expected format
function isValidPathname(pathname: string): boolean {
  // Must not contain path traversal sequences
  if (pathname.includes('..') || pathname.includes('//')) return false
  // Must not start with / or contain null bytes
  if (pathname.startsWith('/') || pathname.includes('\0')) return false
  // Max length guard
  if (pathname.length > 512) return false
  // Must only contain safe characters: alphanumeric, -, _, ., /
  if (!/^[a-zA-Z0-9\-_.\/]+$/.test(pathname)) return false
  return true
}

export async function GET(request: NextRequest) {
  const rl = await withRateLimit(request, 'general')
  if (rl.response) return rl.response

  const pathname = request.nextUrl.searchParams.get('pathname')

  if (!pathname) {
    return NextResponse.json({ error: 'Missing pathname' }, { status: 400 })
  }

  // Validate pathname format before any blob operation
  if (!isValidPathname(pathname)) {
    return NextResponse.json({ error: 'Invalid pathname' }, { status: 400 })
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN

  // Check if token exists
  if (!token) {
    return NextResponse.json({
      error: 'BLOB_READ_WRITE_TOKEN not configured',
      hasToken: false,
    }, { status: 500 })
  }

  // Build the canonical blob URL directly. Skipping the `head()` round-trip
  // (which we used to call just for metadata) halves upstream API calls
  // per asset request - we don't need metadata for the common case, only
  // for conditional requests, which the upstream response already carries.
  //
  // Token format from BLOB_READ_WRITE_TOKEN: `vercel_blob_rw_<STOREID>_<SECRET>`.
  // URL format used internally by @vercel/blob's get():
  //   https://<storeId>.<access>.blob.vercel-storage.com/<pathname>
  // Our blobs are uploaded with access:'private'.
  const storeId = token.split('_')[3] || ''
  if (!storeId) {
    return NextResponse.json({ error: 'Invalid BLOB token format' }, { status: 500 })
  }
  const blobUrl = `https://${storeId}.private.blob.vercel-storage.com/${pathname}`

  try {
    const rangeHeader = request.headers.get('range')
    const ifNoneMatch = request.headers.get('if-none-match')
    const upstreamHeaders: Record<string, string> = {
      authorization: `Bearer ${token}`,
    }
    if (rangeHeader) upstreamHeaders.range = rangeHeader
    if (ifNoneMatch) upstreamHeaders['if-none-match'] = ifNoneMatch

    // CRITICAL: forward the client's AbortSignal so the upstream fetch
    // aborts the moment the client disconnects. Without this, a mobile
    // user closing a tab mid-download leaves our Node process streaming
    // the rest of the file into a buffer that never gets drained -
    // stack hundreds of those and the process bleeds GBs of RAM.
    const upstream = await fetch(blobUrl, {
      headers: upstreamHeaders,
      signal: request.signal,
    })

    // 304 short-circuit (no body to forward).
    if (upstream.status === 304) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: upstream.headers.get('etag') || '',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    }

    if (!upstream.ok && upstream.status !== 206) {
      return new NextResponse('File not available', { status: upstream.status })
    }

    // If the blob was uploaded with a generic content-type (eg. files
    // dragged from Discord that have empty file.type), browsers may not
    // render images/GIFs/videos. Fall back to the filename extension so
    // existing octet-stream blobs still serve correctly.
    const upstreamType = upstream.headers.get('content-type') || ''
    const looksGeneric = !upstreamType || upstreamType === 'application/octet-stream' || upstreamType === 'binary/octet-stream'
    const fromExt = getMimeTypeFromExtension(pathname) || ''
    const contentType = looksGeneric && fromExt ? fromExt : (upstreamType || 'application/octet-stream')

    const headers = new Headers()
    headers.set('Content-Type', contentType)
    headers.set('Accept-Ranges', 'bytes')
    // Aggressive public caching. Uploaded asset URLs include a Date.now()
    // timestamp in the pathname, so they're effectively immutable - a new
    // upload gets a new URL. Cloudflare can serve these directly, sparing
    // our Node origin almost all profile-asset traffic. Without this we
    // were proxying every single asset for every page view through the
    // Railway instance, which is what blew memory + bandwidth costs up.
    headers.set('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable')
    headers.set('X-Content-Type-Options', 'nosniff')
    const upstreamEtag = upstream.headers.get('etag')
    if (upstreamEtag) headers.set('ETag', upstreamEtag)
    const upstreamCL = upstream.headers.get('content-length')
    if (upstreamCL) headers.set('Content-Length', upstreamCL)
    const upstreamCR = upstream.headers.get('content-range')
    if (upstreamCR) headers.set('Content-Range', upstreamCR)

    return new NextResponse(upstream.body, {
      status: upstream.status === 206 ? 206 : 200,
      headers,
    })
  } catch (error: unknown) {
    // AbortError on client disconnect is expected; don't log noise.
    if (error instanceof Error && error.name === 'AbortError') {
      return new NextResponse(null, { status: 499 })
    }
    const errMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('[/api/file] Blob error:', errMessage)

    if (errMessage.includes('not found') || errMessage.includes('404') || errMessage.includes('BlobNotFound')) {
      return new NextResponse('Not found', { status: 404 })
    }

    return NextResponse.json({
      error: 'Failed to serve file',
      message: errMessage,
    }, { status: 500 })
  }
}
