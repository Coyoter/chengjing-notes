package tw.techtarian.chengjing

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.content.res.Configuration
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class VisualResourcesTest {
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    @Test fun launcherEmblemIsCenteredAndInsideAdaptiveSafeZone() {
        val bitmap=Bitmap.createBitmap(1080,1080,Bitmap.Config.ARGB_8888)
        val icon=context.getDrawable(R.drawable.chengjing_emblem)!!
        icon.setBounds(0,0,1080,1080);icon.draw(Canvas(bitmap))
        var left=1080;var top=1080;var right=0;var bottom=0
        for(y in 0 until 1080)for(x in 0 until 1080)if(Color.alpha(bitmap.getPixel(x,y))>10){left=minOf(left,x);right=maxOf(right,x);top=minOf(top,y);bottom=maxOf(bottom,y)}
        assertEquals(539.5,(left+right)/2.0,1.0);assertEquals(539.5,(top+bottom)/2.0,1.0)
        assertTrue(left>=210&&right<=870&&top>=210&&bottom<=870)
        val file=java.io.File(context.getExternalFilesDir(null),"launcher-emblem-qa.png")
        file.outputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)}
        bitmap.recycle()
    }
    @Test fun packageManagerResolvesTheNewLauncherEmblem() {
        val info=context.packageManager.getApplicationInfo(context.packageName,0)
        assertEquals(R.mipmap.chengjing_launcher,info.icon)
        val icon=info.loadIcon(context.packageManager)
        assertTrue(icon is android.graphics.drawable.AdaptiveIconDrawable)
        val bitmap=Bitmap.createBitmap(1080,1080,Bitmap.Config.ARGB_8888)
        icon.setBounds(0,0,1080,1080);icon.draw(Canvas(bitmap))
        // The ivory centre and stem distinguish this emblem from the retired spiral.
        var ivory=0
        for(y in 0 until 1080)for(x in 0 until 1080){val pixel=bitmap.getPixel(x,y);if(Color.red(pixel)>225&&Color.green(pixel)>225&&Color.blue(pixel)>210)ivory++}
        assertTrue("Resolved launcher icon must contain the ivory centre and stem",ivory>1000)
        java.io.File(context.getExternalFilesDir(null),"resolved-launcher-qa.png").outputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)}
        bitmap.recycle()
    }
    @Test fun launchHasNoLogoAndUsesLightAndDarkBackgroundResources() {
        val bitmap=Bitmap.createBitmap(32,32,Bitmap.Config.ARGB_8888)
        val icon=context.getDrawable(R.drawable.launch_empty)!!
        icon.setBounds(0,0,32,32);icon.draw(Canvas(bitmap))
        for(y in 0 until 32)for(x in 0 until 32)assertEquals(0,Color.alpha(bitmap.getPixel(x,y)))
        for((mode,color)in listOf(Configuration.UI_MODE_NIGHT_YES to "#111816",Configuration.UI_MODE_NIGHT_NO to "#f1eee7")){
            val config=Configuration(context.resources.configuration).apply{uiMode=uiMode and Configuration.UI_MODE_NIGHT_MASK.inv() or mode}
            assertEquals(Color.parseColor(color),context.createConfigurationContext(config).getColor(R.color.launch_background))
        }
        bitmap.recycle()
    }
}
