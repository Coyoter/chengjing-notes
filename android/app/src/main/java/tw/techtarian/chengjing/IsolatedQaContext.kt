package tw.techtarian.chengjing

import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import java.io.File

/** Debug-only UI tests never share notes, files, preferences, or tokens. */
internal class IsolatedQaContext(base: Context) : ContextWrapper(base) {
    override fun getFilesDir(): File = File(baseContext.filesDir,"isolated-ui-qa").apply{mkdirs()}
    override fun getCacheDir(): File = File(baseContext.cacheDir,"isolated-ui-qa").apply{mkdirs()}
    override fun getSharedPreferences(name: String, mode: Int): SharedPreferences = baseContext.getSharedPreferences("isolated-ui-qa-$name",mode)
}
