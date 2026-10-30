import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

// Generate the CARMAZE cinematic intro video from the brand hero image,
// download it to public/video/intro.mp4, then exit. Safe to re-run.
const OUT = 'public/video/intro.mp4'
const STATE = '/tmp/intro_video_state.json'

async function main() {
  if (fs.existsSync(OUT)) {
    console.log('intro video already exists — nothing to do')
    return
  }
  const zai = await ZAI.create()
  const b64 = `data:image/png;base64,${fs.readFileSync('public/images/hero.png').toString('base64')}`

  let taskId: string | undefined
  if (fs.existsSync(STATE)) {
    const st = JSON.parse(fs.readFileSync(STATE, 'utf8'))
    if (st.taskId) {
      taskId = st.taskId
      console.log('resuming existing task', taskId)
    }
  }

  if (!taskId) {
    const task = await zai.video.generations.create({
      image_url: b64,
      prompt:
        'Cinematic luxury automotive commercial: the SUV drives smoothly forward along a wet asphalt night road in Nairobi, golden light trails streaking past, reflections shimmering on the road surface, slow elegant cinematic camera dolly alongside the car, deep green and champagne gold color grade, premium car advert aesthetic, smooth motion, photorealistic',
      quality: 'quality',
      duration: 5,
      fps: 30,
    })
    taskId = task.id
    fs.writeFileSync(STATE, JSON.stringify({ taskId }))
    console.log('task created', taskId)
  }

  const maxPolls = 90
  for (let i = 0; i < maxPolls; i++) {
    const result = await zai.async.result.query(taskId as string)
    console.log(`poll ${i + 1}: ${result.task_status}`)
    if (result.task_status === 'SUCCESS') {
      const url: string | undefined =
        result.video_result?.[0]?.url || result.video_url || result.url || result.video
      if (!url) throw new Error('no video url in result')
      console.log('downloading', url)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`download failed: ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      fs.writeFileSync(OUT, buf)
      console.log(`saved ${OUT} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`)
      fs.rmSync(STATE, { force: true })
      return
    }
    if (result.task_status === 'FAIL') throw new Error('video generation failed')
    await new Promise((r) => setTimeout(r, 10000))
  }
  throw new Error('timed out polling video task')
}

main().catch((e) => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
