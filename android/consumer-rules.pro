# Applied to any consuming app that enables R8/ProGuard minification, since this library
# embeds a Ktor CIO HTTP server and kotlinx-coroutines, both of which rely on classes that
# can be reached via reflection/service-loading rather than direct static references and can
# otherwise be stripped or renamed by a consumer's own shrinking pass.

-keep class io.ktor.** { *; }
-keep interface io.ktor.** { *; }
-dontwarn io.ktor.**

-keepclassmembers class kotlin.coroutines.jvm.internal.BaseContinuationImpl {
    *;
}
-keep class kotlinx.coroutines.** { *; }
-keepclassmembers class kotlinx.coroutines.** { *; }
-dontwarn kotlinx.coroutines.**

-keep class com.devioarts.capacitor.rest.** { *; }
