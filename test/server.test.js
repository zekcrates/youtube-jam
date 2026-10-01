import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { normalizeRoom, pickCiphered, pickDirect, server, wss } from '../server/yt-proxy.mjs'

let baseUrl

before(async () => {
  await new Promise((resolve) => server.listen(0, resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve) => wss.close(resolve))
  await new Promise((resolve) => server.close(resolve))
})

const openSocket = async () => {
  const socket = new WebSocket(`${baseUrl.replace('http', 'ws')}/ws`)
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  return socket
}

const waitForMessage = (socket, predicate) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    socket.off('message', onMessage)
    reject(new Error('Timed out waiting for WebSocket message'))
  }, 1500)

  const onMessage = (raw) => {
    let message
    try { message = JSON.parse(String(raw)) } catch { return }
    if (!predicate(message)) return
    clearTimeout(timer)
    socket.off('message', onMessage)
    resolve(message)
  }

  socket.on('message', onMessage)
})

const joinRoom = async (socket, room, name, create = false) => {
  const joined = waitForMessage(socket, (message) => message.t === 'joined')
  socket.send(JSON.stringify({ t: 'join', room, name, create }))
  return joined
}

test('normalizes rooms and prioritizes playable audio formats', () => {
  assert.equal(normalizeRoom(' ab-c_12!3456789 '), 'ABC12345')

  const direct = pickDirect([
    { itag: 22, url: 'video' },
    { itag: 18, url: 'preferred' },
    { itag: 140, has_audio: true, url: 'audio' },
  ])
  assert.equal(direct.url, 'preferred')

  const ciphered = pickCiphered([
    { itag: 251, has_audio: true, signature_cipher: 'cipher', mime_type: 'audio/webm' },
    { itag: 140, has_audio: true, signature_cipher: 'preferred', mime_type: 'audio/mp4' },
  ])
  assert.equal(ciphered.itag, 140)
})

test('serves health and empty-room endpoints without contacting YouTube', async () => {
  const health = await fetch(`${baseUrl}/api/health`)
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { ok: true, yt: false, auth: false })

  const room = await fetch(`${baseUrl}/api/room/NOTFOUND`)
  assert.equal(room.status, 200)
  assert.deepEqual(await room.json(), { room: 'NOTFOUND', members: [], hasState: false })
})

test('rejects malformed video ids before making upstream requests', async () => {
  const stream = await fetch(`${baseUrl}/api/stream?id=not-valid`)
  assert.equal(stream.status, 400)
  assert.deepEqual(await stream.json(), { error: 'bad id' })

  const diagnostic = await fetch(`${baseUrl}/api/diag?id=not-valid`)
  assert.equal(diagnostic.status, 400)
  assert.deepEqual(await diagnostic.json(), { error: 'bad id' })
})

test('returns empty results for empty or too-short search inputs', async () => {
  const search = await fetch(`${baseUrl}/api/search?q=`)
  assert.equal(search.status, 200)
  assert.deepEqual(await search.json(), { tracks: [] })

  const suggestions = await fetch(`${baseUrl}/api/suggest?q=a`)
  assert.equal(suggestions.status, 200)
  assert.deepEqual(await suggestions.json(), { suggestions: [] })
})

test('does not create a room when a client tries to join an unknown code', async () => {
  const socket = await openSocket()
  const errorMessage = waitForMessage(socket, (message) => message.t === 'error')

  try {
    socket.send(JSON.stringify({ t: 'join', room: 'MISSING', name: 'Alice', create: false }))
    const message = await errorMessage
    assert.equal(message.message, 'No jam with code MISSING — check the code and try again.')
  } finally {
    socket.close()
  }
})

test('creates a jam, joins a second client, and syncs membership', async () => {
  const room = `T${Date.now().toString(36).slice(-6).toUpperCase()}`
  const first = await openSocket()
  const second = await openSocket()

  try {
    const firstJoined = await joinRoom(first, room, 'Alice', true)
    assert.equal(firstJoined.room, room)
    assert.deepEqual(firstJoined.members, ['Alice'])

    const membershipUpdate = waitForMessage(first, (message) => message.t === 'members' && message.members.includes('Bob'))
    const secondJoined = await joinRoom(second, room.toLowerCase(), 'Bob')

    assert.deepEqual(secondJoined.members.sort(), ['Alice', 'Bob'])
    assert.deepEqual((await membershipUpdate).members.sort(), ['Alice', 'Bob'])
  } finally {
    first.close()
    second.close()
  }
})

test('notifies remaining members when someone disconnects', async () => {
  const room = `L${Date.now().toString(36).slice(-6).toUpperCase()}`
  const first = await openSocket()
  const second = await openSocket()

  try {
    await joinRoom(first, room, 'Alice', true)
    await joinRoom(second, room, 'Bob')

    const membershipUpdate = waitForMessage(second, (message) => message.t === 'members' && message.members.length === 1)
    first.close()

    assert.deepEqual(await membershipUpdate, { t: 'members', members: ['Bob'] })
  } finally {
    second.close()
  }
})

test('broadcasts playback state and chat messages to other jam members', async () => {
  const room = `S${Date.now().toString(36).slice(-6).toUpperCase()}`
  const first = await openSocket()
  const second = await openSocket()
  const third = await openSocket()

  try {
    await joinRoom(first, room, 'Alice', true)
    await joinRoom(second, room, 'Bob')

    const stateMessage = waitForMessage(second, (message) => message.t === 'state')
    first.send(JSON.stringify({
      t: 'state',
      state: {
        videoId: 'abc12345678',
        track: { trackId: 'track-1', trackName: 'A song' },
        position: 42,
        playing: true,
      },
    }))

    const state = await stateMessage
    assert.equal(state.state.videoId, 'abc12345678')
    assert.equal(state.state.position, 42)
    assert.equal(state.state.by, 'Alice')
    assert.ok(state.state.at)

    const lateJoin = await joinRoom(third, room, 'Carol')
    assert.equal(lateJoin.state.track.trackId, 'track-1')
    assert.equal(lateJoin.state.playing, true)

    const chatMessage = waitForMessage(second, (message) => message.t === 'chat')
    first.send(JSON.stringify({ t: 'chat', text: `  ${'x'.repeat(400)}  ` }))
    assert.equal((await chatMessage).message.text.length, 280)
  } finally {
    first.close()
    second.close()
    third.close()
  }
})
